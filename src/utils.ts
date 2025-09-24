import {geoMercator} from "d3-geo";
import {CoreTemplate, WplaceCoordinate, GriefCache, GriefStats} from "./scanner";
import * as env from "env-var";
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
    stats: GriefStats
}
const templateBaseURL = env.get("FILESERVER_BASEURL").asString();
if(!templateBaseURL) console.warn("Template linking is disabled because FILESERVER_BASEURL is unset")
export const wplaceLink = ({lat,lng}: WorldCoordinate) => `https://wplace.live/?lat=${lat}&lng=${lng}&zoom=15`;
export const templateLink = ({name, location}: CoreTemplate) => {
    if(templateBaseURL) {
        return `**[${name}](${encodeURI(`${templateBaseURL}/${location.tx} ${location.ty}/${location.px} ${location.py} ${name}.png`)})** ([${location.tx} ${location.ty} ${location.px} ${location.py}](<${wplaceLink(geoCoords(location))}>))`
    } else {
        return `**[${name}](<${wplaceLink(geoCoords(location))}>)**`
    }
}
export const templateStats = ({template, stats}: TemplateStatsOptions) => `${tempStatsEmoji(stats)} ${templateLink(template)} mismatch: ${stats.mismatches}/${stats.pixels} (~${((stats.mismatches/stats.pixels)*100).toFixed(1)}%) pixels`;
export const tempStatsEmoji = (stats: GriefStats) => {
    if(stats.mismatches === 0) return "🦭";
    if(stats.increasing === null) return "🤷‍♀️";
    return stats.increasing ? "📈" : "📉";
}

export const dataFromFilename = (filename: string): CoreTemplate | null => {
    const grab = /^(?<tx>\d+) (?<ty>\d+)\/(?<px>\d+) (?<py>\d+) (?<name>.+)\.png$/.exec(filename);
    if(!grab?.groups) return null;

    const {tx, ty, px, py, name} = grab.groups;
    return {
        name, location: {
            tx: parseInt(tx),
            ty: parseInt(ty),
            px: parseInt(px),
            py: parseInt(py)
        }
    }
}

export const griefList = (griefCache: GriefCache) => {
    let topText = "## top griefs";
    let bottomText = "";
    const flatCache = Object.values(griefCache).flatMap(tile => Object.values(tile));
    const templates = flatCache.filter(temp => temp.stats.mismatches > 0).sort((a,b) => b.stats.mismatches-a.stats.mismatches);

    for (const temp of templates.slice()) {
        const add = `\n${templateStats(temp)}`;
        if((topText + add).length > 1950) break;
        topText += add;
        templates.shift();
    }
    for (const temp of templates.reverse()) {
        const add = `\n${templateStats(temp)}`;
        if((bottomText + add + "## bottom griefs 🥺").length > 1950) break;
        bottomText = add + bottomText;
    }

    if(topText === "## top griefs") topText += "\n* WOW! none! 🦭";
    return {topText, bottomText: bottomText ? "## bottom griefs 🥺" + bottomText : null};
}

// https://github.com/LITdevs/ban-chan/blob/7f4d4847c22d8cb03137752268b0c2b92fdc4770/index.js#L10
// ideally improve on this logic later
export async function findManagedMessage(channel: GuildTextBasedChannel, author: string, offset = 0): Promise<Message | null> {
    const messages = (await channel.messages.fetch()).filter(message => message.author.id === author).reverse();
    const message = messages.at(offset);

    if(message?.author.id === author) return message;
    return null;
}