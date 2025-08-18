import * as fs from "node:fs/promises";
import EventEmitter from "node:events";
import sharp, {Sharp} from "sharp";

type TemplateStore = Record<string, Record<string, Sharp>>;

export default class Scanner extends EventEmitter {
    #templates: TemplateStore = {};

    constructor() {
        super();
        void this.#init();
    }

    async #init() {
        const tiles = await fs.readdir("templates");
        let templateCount = 0;
        for (const tile of tiles) {
            const templates = await fs.readdir(`templates/${tile}`);
            this.#templates[tile] = {};
            for (const template of templates) {
                this.#templates[tile][template] = sharp(await fs.readFile(`templates/${tile}/${template}`));
                templateCount++;
            }
        }

        this.emit("load", {tiles: tiles.length, templates: templateCount})

        void this.#scanLoop();
    }

    async #scanLoop() {
        await this.#scan();
        setTimeout(() => this.#scanLoop(), 60 * 1000);
    }

    async #scan() {
        for (const tile of Object.keys(this.#templates)) {
            const coords = tile.split(" ");
            let tileFile;
            try {
                tileFile = await fetch(`https://backend.wplace.live/files/s0/tiles/${coords[0]}/${coords[1]}.png`, {signal: AbortSignal.timeout(5*1000)});
            } catch {continue;}
            if(!tileFile.ok) continue;

            const tileSharp = sharp(await tileFile.arrayBuffer());

            for (const [templateName, template] of Object.entries(this.#templates[tile])) {
                const check = await this.#checkTemplate(template, parseInt(templateName.split(" ")[0]), parseInt(templateName.split(" ")[1]), tileSharp)
                if(check.errors > 0) {
                    this.emit("grief", {...check, name: templateName, tile});
                } else {
                    this.emit("clean", {...check, name: templateName, tile});
                }
            }
        }
    }

    async #checkTemplate(template: Sharp, x: number, y: number, tile: Sharp) {
        const templateBuffer = await template.clone().raw().ensureAlpha().toBuffer({resolveWithObject: true});
        const tempPixels = templateBuffer.data;
        const tileExtract = await tile.clone().extract({left: x, top: y, height: templateBuffer.info.height, width: templateBuffer.info.width})
        const tilePixels = await tileExtract.clone().raw().ensureAlpha().toBuffer();

        let errors = 0;
        let pixels = 0;
        let diffData = [];

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

        const neoTile = await sharp(Buffer.from(diffData), {
            raw: {...templateBuffer.info}
        }).png();
        return {pixels, errors, tile, image: neoTile, width: templateBuffer.info.width};
    }
}