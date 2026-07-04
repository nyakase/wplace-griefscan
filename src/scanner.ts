import * as fs from "node:fs/promises";
import EventEmitter from "node:events";
import sharp, {Sharp} from "sharp";
import chokidar from "chokidar";
import {dataFromFilename, sleep} from "./utils";
import * as env from "env-var";
import { join } from "node:path";

type TemplateStore = Record<string, Record<string, Sharp>>;
export type GriefCache = {
    writtenAt: Date | null;
    tiles: Record<string, {
        fetchedAt: Date | null;
        templates: Record<string, {stats: GriefStats, template: CoreTemplate}>;
    }>;
};
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
    "templateState": [{
        state: "added" | "updated" | "removed",
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

const templateFolder = env.get("TEMPLATE_FOLDER").asString() || join(__dirname, "../templates");
export default class Scanner extends EventEmitter<ScannerEvents> {
    #templates: TemplateStore = {};
    griefCache: GriefCache = {writtenAt: null, tiles: {}};

    constructor() {
        super();
    }

    start() {
        const pends = new Set();
        const updateWrap = (filename: string, state: "added" | "updated") => {
            const templateData = dataFromFilename(filename);
            if(!templateData) return;

            const pend = this.#fileUpdate(filename);
            pends.add(pend); void pend.finally(() => pends.delete(pend))
            if(isReady) void pend.then(() => this.emit("templateState", {state, template: templateData}))
        }
        let isReady = false;

        chokidar.watch(".", {cwd: templateFolder, awaitWriteFinish: true})
            .on("addDir", (dir) => {
                if(!/^\d+ \d+$/.test(dir)) return;
                this.#templates[dir] = {};
                this.griefCache.tiles[dir] = {fetchedAt: null, templates: {}};
            })
            .on("add", (filename) => updateWrap(filename, "added"))
            .on("change", (filename) => updateWrap(filename, "updated"))
            .on("unlink", (filename) => {
                const templateData = dataFromFilename(filename);
                if(!templateData) return;

                const [tileID, templateName] = filename.split("/");
                delete this.#templates[tileID]?.[templateName];
                delete this.griefCache.tiles[tileID]?.templates[templateName];
                if(isReady) this.emit("templateState", {state: "removed", template: templateData})
            })
            .on("unlinkDir", (dir) => {
                if(!/^\d+ \d+$/.test(dir)) return;
                delete this.#templates[dir];
                delete this.griefCache.tiles[dir];
            })
            .on("ready", () => {
                isReady = true;
                void Promise.all(pends).then(() => this.#scanLoop());
            })
    }

    templateFile(template: CoreTemplate) {
        return this.#templates[`${template.location.tx} ${template.location.ty}`]?.
            [`${template.location.px} ${template.location.py} ${template.name}.png`] || null;
    }

    async #fileUpdate(filename: string) {
        if(!dataFromFilename(filename)) return Promise.resolve();
        const [tileID, templateName] = filename.split("/");

        return fs.readFile(join(templateFolder, tileID, templateName)).then(image => {
            if(image.length === 0) return console.warn(`Saw "${filename}" but it's an empty file..`)
            this.#templates[tileID][templateName] = sharp(image);
        }).catch(err => console.error(err))
    }

    async #scanLoop() {
        console.log("Scanning...", new Date())
        try {await this.#scan()} catch(e) {console.error("Scan failed.", e)}
        setTimeout(() => void this.#scanLoop(), 60 * 1000);
    }

    async #scan() {
        let mismatches = 0, pixels = 0, tileCount = 0, templateCount = 0, trueTemplateCount = 0;
        const scanResults = structuredClone(this.griefCache);
        const allTiles = Object.keys(this.#templates);

        for (const tileID of allTiles) {
            const coords = tileID.split(" ");
            const allTemplates = Object.entries(this.#templates[tileID]);
            trueTemplateCount += allTemplates.length;

            let tileFile;
            try {
                tileFile = await fetch(`https://backend.wplace.live/files/s0/tiles/${coords[0]}/${coords[1]}.png`, {signal: AbortSignal.timeout(5*1000)});
            } catch(e) {console.error(`Failed to download "${coords[0]} ${coords[1]}": ${e instanceof Error ? e.message : String(e)}`); continue;}
            if(!tileFile.ok) {console.warn(`HTTP ${tileFile.status} for "${coords[0]} ${coords[1]}".`); continue;}

            tileCount++;
            scanResults.tiles[tileID].fetchedAt = new Date();
            const tileSharp = sharp(await tileFile.arrayBuffer());

            for (const [templateName, template] of allTemplates) {
                try {
                    const templateData = dataFromFilename(`${tileID}/${templateName}`)!;
                    const check = await this.#checkTemplate(template, templateData.location.px, templateData.location.py, tileSharp)

                    mismatches += check.mismatches; pixels += check.pixels; templateCount++;

                    const prevCache = this.griefCache.tiles[tileID].templates[templateName];
                    const firstScan = !prevCache;
                    const hasChanged = check.mismatches !== prevCache?.stats.mismatches;
                    const increasing = firstScan ? null :
                        check.mismatches === prevCache.stats.mismatches ? prevCache.stats.increasing :
                            check.mismatches > prevCache.stats.mismatches;

                    scanResults.tiles[tileID].templates[templateName] = {template: templateData, stats: {pixels: check.pixels, mismatches: check.mismatches, increasing}};

                    if(firstScan && check.mismatches > 0 || !firstScan && hasChanged) {
                        if(check.mismatches > 0) console.log(`Found mismatch in "${tileID}/${templateName}", ${check.mismatches}/${check.pixels} pixels.`)
                        this.emit(check.mismatches > 0 ? "newGrief" : "newClean", {...scanResults.tiles[tileID].templates[templateName], snapshot: check.snapshot, width: check.width})
                    }
                } catch (e) {
                    console.error(`Trouble checking "${tileID}/${templateName}".`, e)
                }
            }

            await sleep(300);
        }

        scanResults.writtenAt = new Date();
        this.griefCache = scanResults;

        this.emit("scannedAll", {mismatches, pixels, scannedTileCount: tileCount, scannedTemplateCount: templateCount, trueTileCount: allTiles.length, trueTemplateCount, griefCache: this.griefCache});
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
            const shouldBeTransparent = tempRGBA[0] === 222 && tempRGBA[1] === 250 && tempRGBA[2] === 206 && tempRGBA[3] === 255;
            if(shouldBeTransparent) tempRGBA = [0,0,0,0];

            if(
                tempRGBA[0] !== tileRGBA[0] ||
                tempRGBA[1] !== tileRGBA[1] ||
                tempRGBA[2] !== tileRGBA[2] ||
                tempRGBA[3] !== tileRGBA[3]
            ) {
                diffData.push(tempRGBA[0], tempRGBA[1], tempRGBA[2], tempRGBA[3]);
                if(tempRGBA[3] !== 0 || shouldBeTransparent && tileRGBA[3] !== 0) {
                    mismatches += 1;
                }
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