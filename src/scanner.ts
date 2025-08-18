import * as fs from "node:fs/promises";
import EventEmitter from "node:events";
import sharp, {Sharp} from "sharp";

type TemplateStore = Record<string, Record<string, Sharp>>;
type ScannerEvents = {
    "load": [{tiles: number, templates: number}],
    "grief": [{
        pixels: number, width: number, errors: number,
        tileID: string, templateName: string, snapshot: Sharp
    }],
    "clean": ScannerEvents["grief"]
}

export default class Scanner extends EventEmitter<ScannerEvents> {
    #templates: TemplateStore = {};

    constructor() {
        super();
        void this.#init();
    }

    async #init() {
        const tiles = await fs.readdir("templates");
        let templateCount = 0;
        for (const tileID of tiles) {
            const templates = await fs.readdir(`templates/${tileID}`);
            this.#templates[tileID] = {};
            for (const templateName of templates) {
                this.#templates[tileID][templateName] = sharp(await fs.readFile(`templates/${tileID}/${templateName}`));
                templateCount++;
            }
        }

        this.emit("load", {tiles: tiles.length, templates: templateCount})

        void this.#scanLoop();
    }

    async #scanLoop() {
        await this.#scan();
        setTimeout(() => void this.#scanLoop(), 60 * 1000);
    }

    async #scan() {
        for (const tileID of Object.keys(this.#templates)) {
            const coords = tileID.split(" ");
            let tileFile;
            try {
                tileFile = await fetch(`https://backend.wplace.live/files/s0/tiles/${coords[0]}/${coords[1]}.png`, {signal: AbortSignal.timeout(5*1000)});
            } catch {continue;}
            if(!tileFile.ok) continue;

            const tileSharp = sharp(await tileFile.arrayBuffer());

            for (const [templateName, template] of Object.entries(this.#templates[tileID])) {
                const check = await this.#checkTemplate(template, parseInt(templateName.split(" ")[0]), parseInt(templateName.split(" ")[1]), tileSharp)
                if(check.errors > 0) {
                    this.emit("grief", {...check, templateName, tileID});
                } else {
                    this.emit("clean", {...check, templateName, tileID});
                }
            }
        }
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
                if(tempRGBA[3] !== 0 && !shouldBeTransparent) errors += 1;
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