import {geoMercator} from "d3-geo";
import {CoreTemplate, WplaceCoordinate} from "./scanner";
import * as env from "env-var";
import {GriefCache} from "./index";
import {GuildTextBasedChannel, Message} from "discord.js";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)); // https://stackoverflow.com/a/39914235

// https://observablehq.com/@d3/web-mercator-tiles
export function geoCoords({tx, ty, px, py}: WplaceCoordinate) {
    const tileScale = 1000;
    const mapScale = 2048 * tileScale;

    const projection = geoMercator()
        .scale(mapScale / (2 * Math.PI))
        .translate([mapScale / 2, mapScale / 2]);
    const x = tx * tileScale + px + 0.5;
    const y = ty * tileScale + py + 0.5;

    const res = projection.invert?.([x, y]);
    if(!res) throw new Error("Coordinates are null for some reason >.>");

    const [lng,lat] = res;
    return {lat: lat.toFixed(6), lng: lng.toFixed(6)};
}

type WorldCoordinate = {lat: string; lng: string};
type TemplateStatsOptions = {
    template: CoreTemplate,
    errors: number
}
const templateBaseURL = env.get("FILESERVER_BASEURL").asString();
export const wplaceLink = ({lat,lng}: WorldCoordinate) => `https://wplace.live/?lat=${lat}&lng=${lng}&zoom=15`;
export const templateLink = ({name, location}: CoreTemplate) => {
    if(templateBaseURL) {
        return `**[${name}](${encodeURI(`${templateBaseURL}/${location.tx} ${location.ty}/${location.px} ${location.py} ${name}.png`)})** ([${location.tx} ${location.ty} ${location.px} ${location.py}](<${wplaceLink(geoCoords(location))}>))`
    } else {
        return `**[${name}](<${wplaceLink(geoCoords(location))}>)**`
    }
}
export const templateStats = ({template, errors}: TemplateStatsOptions) => `${templateLink(template)} mismatch: ${errors}/${template.pixels} (~${((errors/template.pixels)*100).toFixed(1)}%) pixels`;
export const griefList = (griefCache: GriefCache) => {
    let text = "## top 10 griefs";
    const flatCache = Object.values(griefCache).flatMap(tile => Object.values(tile));
    const templates = flatCache.sort((a,b) => b.errors-a.errors).slice(0,10);

    for (const temp of templates) {
        if (temp.errors === 0) break;
        text += `\n* ${templateStats({template: temp.template, errors: temp.errors})}`;
    }

    if(text === "## top 10 griefs") text += "\n* WOW! none!";
    return text;
}

// https://github.com/LITdevs/ban-chan/blob/7f4d4847c22d8cb03137752268b0c2b92fdc4770/index.js#L10
// ideally improve on this logic later
export async function findManagedMessage(channel: GuildTextBasedChannel, author: string): Promise<Message | null> {
    const message = (await channel.messages.fetch({limit:1})).first();

    if(message?.author.id === author) return message;
    return null;
}