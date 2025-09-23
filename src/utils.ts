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
export const griefList = (griefCache: GriefCache) => {
    let text = "## top griefs";
    const flatCache = Object.values(griefCache).flatMap(tile => Object.values(tile));
    const templates = flatCache.sort((a,b) => b.stats.mismatches-a.stats.mismatches).slice(0,10);

    for (const temp of templates) {
        if (temp.stats.mismatches === 0) break;
        const add = `\n${templateStats(temp)}`;
        if((text + add).length > 1950) break;
        text += add;
    }

    if(text === "## top griefs") text += "\n* WOW! none! 🦭";
    return text;
}

// https://github.com/LITdevs/ban-chan/blob/7f4d4847c22d8cb03137752268b0c2b92fdc4770/index.js#L10
// ideally improve on this logic later
export async function findManagedMessage(channel: GuildTextBasedChannel, author: string): Promise<Message | null> {
    const message = (await channel.messages.fetch({limit:1})).first();

    if(message?.author.id === author) return message;
    return null;
}