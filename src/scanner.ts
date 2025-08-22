import * as fs from "node:fs/promises";
import EventEmitter from "node:events";
import sharp, {Sharp} from "sharp";
import chokidar from "chokidar";
import {sleep} from "./utils";

type TemplateStore = Record<string, Record<string, Sharp>>;
type ScannerEvents = {
    "scanned": [{pixels: number, errors: number, tileCount: number, trueTileCount: number, templateCount: number}],
    "grief": [{
        width: number, pixels: number, errors: number,
        template: CoreTemplate, snapshot: Sharp
    }],
    "clean": ScannerEvents["grief"],
}
export type WplaceCoordinate = {
    tx: number, ty: number, px: number, py: number
}
export type CoreTemplate = {
    name: string, location: WplaceCoordinate
}

export default class Scanner extends EventEmitter<ScannerEvents> {
    #templates: TemplateStore = {};

    constructor() {
        super();
        this.#init();
    }

    #init() {
        const pends = new Set();
        const updateWrap = (filename: string) => {
            const pend = this.#fileUpdate(filename);
            pends.add(pend); void pend.finally(() => pends.delete(pend))
        }

        chokidar.watch(".", {cwd: "templates"})
            .on("addDir", (dir) => {
                if(!/^\d+ \d+$/.test(dir)) return;
                this.#templates[dir] = {};
            })
            .on("add", (filename) => updateWrap(filename))
            .on("change", (filename) => updateWrap(filename))
            .on("unlink", (filename) => {
                if(!/^\d+ \d+\/\d+ \d+ .+\.png$/.test(filename)) return;
                const [tileID, templateName] = filename.split("/");
                delete this.#templates[tileID]?.[templateName];
            })
            .on("unlinkDir", (dir) => {
                if(!/^\d+ \d+$/.test(dir)) return;
                delete this.#templates[dir];
            })
            .on("ready", () => void Promise.all(pends).then(() => void this.#scanLoop()))
    }

    #fileUpdate(filename: string) {
        if(!/^\d+ \d+\/\d+ \d+ .+\.png$/.test(filename)) return Promise.resolve();
        const [tileID, templateName] = filename.split("/");

        return fs.readFile(`templates/${tileID}/${templateName}`).then(image => {
            if(image.length === 0) return console.warn(`Saw "${filename}" but it's an empty file. Assuming upload pending.`)
            this.#templates[tileID][templateName] = sharp(image);
        }).catch(err => console.error(err))
    }

    async #scanLoop() {
        console.log("Scanning...", new Date())
        try {await this.#scan()} catch(e) {console.error("Scan failed.", e)}
        setTimeout(() => void this.#scanLoop(), 60 * 1000);
    }

    async #scan() {
        let errors = 0; let pixels = 0; let templateCount = 0; let tileCount = 0;

        for (const tileID of Object.keys(this.#templates)) {
            const coords = tileID.split(" ");
            let tileFile;
            try {
                tileFile = await fetch(`https://backend.wplace.live/files/s0/tiles/${coords[0]}/${coords[1]}.png`, {signal: AbortSignal.timeout(5*1000)});
            } catch {console.warn(`Failed to check tile ${coords[0]} ${coords[1]}`); continue;}
            if(!tileFile.ok) {console.warn(`Failed to check tile ${coords[0]} ${coords[1]}`); continue;}

            tileCount++;
            const tileSharp = sharp(await tileFile.arrayBuffer());

            for (const [templateName, template] of Object.entries(this.#templates[tileID])) {
                const check = await this.#checkTemplate(template, parseInt(templateName.split(" ")[0]), parseInt(templateName.split(" ")[1]), tileSharp)

                errors += check.errors; pixels += check.pixels; templateCount++;
                const templateLocation: WplaceCoordinate = {
                    tx: parseInt(tileID.split(" ")[0]),
                    ty: parseInt(tileID.split(" ")[1]),
                    px: parseInt(templateName.split(" ")[0]),
                    py: parseInt(templateName.split(" ")[1])
                }
                const parsedTemplateName = templateName.match(/\d+ \d+ (.+)\..+/)?.[1] || "unknown";

                if(check.errors > 0) {
                    this.emit("grief", {...check, template: {name: parsedTemplateName, location: templateLocation}});
                    console.log(`Found mismatch in "${tileID}/${templateName}", ${check.errors}/${check.pixels} pixels.`)
                } else {
                    this.emit("clean", {...check, template: {name: parsedTemplateName, location: templateLocation}});
                }
            }

            await sleep(300);
        }

        this.emit("scanned", {errors, pixels, tileCount, templateCount, trueTileCount: Object.keys(this.#templates).length});
    }

    async #checkTemplate(template: Sharp, x: number, y: number, tile: Sharp) {
        const templateBuffer = await template.clone().raw().ensureAlpha().toBuffer({resolveWithObject: true});
        const tempPixels = templateBuffer.data;
        const tileExtract = tile.clone().extract({left: x, top: y, height: templateBuffer.info.height, width: templateBuffer.info.width});
        const tilePixels = await tileExtract.clone().raw().ensureAlpha().toBuffer();

        let errors = 0;
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
                if(tempRGBA[3] !== 0 || shouldBeTransparent && tileRGBA[3] !== 0) errors += 1;
            } else {
                diffData.push(tileRGBA[0], tileRGBA[1], tileRGBA[2], tempRGBA[3] === 0 ? 0 : 50);
            }

            if(tempRGBA[3] === 0 && !shouldBeTransparent) continue;

            pixels += 1;
        }

        const snapshot = sharp(Buffer.from(diffData), {
            raw: {...templateBuffer.info}
        }).png();
        return {pixels, errors, snapshot, width: templateBuffer.info.width};
    }
}