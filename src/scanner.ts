import * as fs from "node:fs/promises";
import EventEmitter from "node:events";
import sharp, {Sharp} from "sharp";
import chokidar from "chokidar";
import {dataFromFilename, sleep} from "./utils";
import * as env from "env-var";
import { join } from "node:path";

type TemplateStore = Record<string, Record<string, Sharp>>;
export type GriefCache = Record<string, Record<string, {stats: GriefStats, template: CoreTemplate}>>;
type ScannerEvents = {
    "scannedAll": [{
        pixels: number, mismatches: number,
        scannedTileCount: number, scannedTemplateCount: number
        trueTileCount: number, trueTemplateCount: number, griefCache: GriefCache
    }],
    "newGrief": [{
        stats: GriefStats, template: CoreTemplate,
        width: number, snapshot: Sharp
    }], "newClean": ScannerEvents["newGrief"],
    "templateChange": [{
        template: CoreTemplate
    }]
}
export type WplaceCoordinate = {
    tx: number, ty: number, px: number, py: number
}
export type CoreTemplate = {
    name: string, location: WplaceCoordinate
}
export type GriefStats = {
    pixels: number, mismatches: number, increasing: boolean | null
}
type CharityOverlay = {
    faction: string, contact: string,
    templates: {
        name: string, source: string,
        coords: [number,number,number,number]
    }[]
}

const faction = env.get("OVERLAY_FACTION").asString();
const factionContact = env.get("OVERLAY_CONTACT").asString();
const templateBaseURL = env.get("FILESERVER_BASEURL").asString();

export default class Scanner extends EventEmitter<ScannerEvents> {
    #templates: TemplateStore = {};
    #griefCache: GriefCache = {};

    constructor() {
        super();
        this.#init();
    }

    #init() {
        const pends = new Set();
        const updateWrap = (filename: string) => {
            const templateData = dataFromFilename(filename);
            if(!templateData) return;

            const pend = this.#fileUpdate(filename);
            pends.add(pend); void pend.finally(() => pends.delete(pend))
            if(isReady) void pend.then(() => this.emit("templateChange", {template: templateData}))
        }
        let isReady = false;

        chokidar.watch(".", {cwd: "templates", awaitWriteFinish: true})
            .on("addDir", (dir) => {
                if(!/^\d+ \d+$/.test(dir)) return;
                this.#templates[dir] = {};
                this.#griefCache[dir] = {};
            })
            .on("add", (filename) => updateWrap(filename))
            .on("change", (filename) => updateWrap(filename))
            .on("unlink", (filename) => {
                if(!dataFromFilename(filename)) return;
                const [tileID, templateName] = filename.split("/");
                delete this.#templates[tileID]?.[templateName];
                delete this.#griefCache[tileID]?.[templateName];
            })
            .on("unlinkDir", (dir) => {
                if(!/^\d+ \d+$/.test(dir)) return;
                delete this.#templates[dir];
                delete this.#griefCache[dir];
            })
            .on("ready", () => {
                isReady = true;
                void Promise.all(pends).then(() => {
                    void this.#scanLoop();
                    this.#writeOverlay();
                })
            })
            .on("all", (_event, filename) => {
                if(!isReady || !/^\d+ \d+(?:\/\d+ \d+ .+\.png|)$/.test(filename)) return;
                void Promise.all(pends).then(() => this.#writeOverlay())
            })
    }

    async #fileUpdate(filename: string) {
        if(!dataFromFilename(filename)) return Promise.resolve();
        const [tileID, templateName] = filename.split("/");

        return fs.readFile(`templates/${tileID}/${templateName}`).then(image => {
            if(image.length === 0) return console.warn(`Saw "${filename}" but it's an empty file..`)
            this.#templates[tileID][templateName] = sharp(image);
        }).catch(err => console.error(err))
    }

    #writeOverlay() {
        if(!faction || !factionContact || !templateBaseURL) return;
        const overlay: CharityOverlay = {
            faction: faction, contact: factionContact,
            templates: []
        }

        for (const tileID of Object.keys(this.#templates)) {
            for (const templateName of Object.keys(this.#templates[tileID])) {
                const templateData = dataFromFilename(`${tileID}/${templateName}`)!;
                overlay.templates.push({
                    name: templateData.name,
                    source: encodeURI(`${templateBaseURL}/${tileID}/${templateName}`),
                    coords: [templateData.location.tx, templateData.location.ty,
                        templateData.location.px, templateData.location.py]
                })
            }
        }

        void fs.writeFile(join(__dirname, "../templates/overlay.json"), JSON.stringify(overlay));
    }

    async #scanLoop() {
        console.log("Scanning...", new Date())
        try {await this.#scan()} catch(e) {console.error("Scan failed.", e)}
        setTimeout(() => void this.#scanLoop(), 60 * 1000);
    }

    async #scan() {
        let mismatches = 0, pixels = 0, tileCount = 0, templateCount = 0, trueTemplateCount = 0;
        const allTiles = Object.keys(this.#templates);

        for (const tileID of allTiles) {
            const coords = tileID.split(" ");
            const allTemplates = Object.entries(this.#templates[tileID]);
            trueTemplateCount += allTemplates.length;

            let tileFile;
            try {
                tileFile = await fetch(`https://backend.wplace.live/files/s0/tiles/${coords[0]}/${coords[1]}.png`, {signal: AbortSignal.timeout(5*1000)});
            } catch {console.warn(`Couldn't download tile "${coords[0]} ${coords[1]}".`); continue;}
            if(!tileFile.ok) {console.warn(`Couldn't download tile "${coords[0]} ${coords[1]}".`); continue;}

            tileCount++;
            const tileSharp = sharp(await tileFile.arrayBuffer());

            for (const [templateName, template] of allTemplates) {
                try {
                    const templateData = dataFromFilename(`${tileID}/${templateName}`)!;
                    const check = await this.#checkTemplate(template, templateData.location.px, templateData.location.py, tileSharp)

                    mismatches += check.mismatches; pixels += check.pixels; templateCount++;

                    const prevCache = this.#griefCache[tileID][templateName];
                    const firstScan = !prevCache;
                    const hasChanged = check.mismatches !== prevCache?.stats.mismatches;
                    const increasing = firstScan ? null :
                        check.mismatches === prevCache.stats.mismatches ? prevCache.stats.increasing :
                            check.mismatches > prevCache.stats.mismatches;

                    this.#griefCache[tileID][templateName] = {template: templateData, stats: {pixels: check.pixels, mismatches: check.mismatches, increasing}};

                    if(firstScan && check.mismatches > 0 || !firstScan && hasChanged) {
                        if(check.mismatches > 0) console.log(`Found mismatch in "${tileID}/${templateName}", ${check.mismatches}/${check.pixels} pixels.`)
                        this.emit(check.mismatches > 0 ? "newGrief" : "newClean", {...this.#griefCache[tileID][templateName], snapshot: check.snapshot, width: check.width})
                    }
                } catch (e) {
                    console.error(`Trouble checking "${tileID}/${templateName}".`, e)
                }
            }

            await sleep(300);
        }

        this.emit("scannedAll", {mismatches, pixels, scannedTileCount: tileCount, scannedTemplateCount: templateCount, trueTileCount: allTiles.length, trueTemplateCount, griefCache: this.#griefCache});
    }

    async #checkTemplate(template: Sharp, x: number, y: number, tile: Sharp) {
        const templateBuffer = await template.clone().raw().ensureAlpha().toBuffer({resolveWithObject: true});
        const tempPixels = templateBuffer.data;
        const tileExtract = tile.clone().extract({left: x, top: y, height: templateBuffer.info.height, width: templateBuffer.info.width});
        const tilePixels = await tileExtract.clone().raw().ensureAlpha().toBuffer();

        let mismatches = 0;
        let pixels = 0;
        const diffData = [];

        for(let block = 0; block < tempPixels.length; block += 4) {
            let tempRGBA = [tempPixels[block], tempPixels[block + 1], tempPixels[block + 2], tempPixels[block + 3]];
            const tileRGBA = [tilePixels[block], tilePixels[block + 1], tilePixels[block + 2], tilePixels[block + 3]];
            const shouldBeTransparent = tempRGBA[0] === 222 && tempRGBA[1] === 250 && tempRGBA[2] === 206;
            if(shouldBeTransparent) tempRGBA = [0,0,0,0];

            if(
                tempRGBA[0] !== tileRGBA[0] ||
                tempRGBA[1] !== tileRGBA[1] ||
                tempRGBA[2] !== tileRGBA[2] ||
                tempRGBA[3] !== tileRGBA[3]
            ) {
                diffData.push(tempRGBA[0], tempRGBA[1], tempRGBA[2], tempRGBA[3]);
                if(tempRGBA[3] !== 0 || shouldBeTransparent && tileRGBA[3] !== 0) mismatches += 1;
            } else {
                diffData.push(tileRGBA[0], tileRGBA[1], tileRGBA[2], tempRGBA[3] === 0 ? 0 : 50);
            }

            if(tempRGBA[3] === 0 && !shouldBeTransparent) continue;

            pixels += 1;
        }

        const snapshot = sharp(Buffer.from(diffData), {
            raw: {...templateBuffer.info}
        }).png();
        return {pixels, mismatches, snapshot, width: templateBuffer.info.width};
    }
}