import "dotenv/config";
import * as env from 'env-var';
import Scanner from "./scanner";
import {Client, Events, GatewayIntentBits, ChannelType, ActivityType} from "discord.js";
import {geoCoords, wplaceLink} from "./utils";

const client = new Client({intents: [GatewayIntentBits.Guilds]})
type GriefCache = Record<string, Record<string, number>>;
const griefCache: GriefCache = {};

client.once(Events.ClientReady, (client) => {
    console.log(`Yo! Logged in as ${client.user.username}`);
    client.user.setPresence({activities: [{type: ActivityType.Watching, name: "your pixels"}]})

    void startScanner();
})

async function startScanner() {
    const channel = await client.channels.fetch(env.get("DISCORD_CHANNEL").required().asString());
    if(channel?.type !== ChannelType.GuildText) throw new Error("Can't send messages in the channel >.>");

    const scanner = new Scanner();
    let lastTopicUpdate = 0; // lol
    scanner.on("scanned", (counts) => {
        const serverStruggling = counts.trueTileCount !== counts.tileCount;

        const topic = serverStruggling ? "Couldn't check some tiles" : `Checking ${counts.tileCount} tiles against ${counts.templateCount} templates • ${counts.errors}/${counts.pixels} mismatched pixels`;
        if(channel.topic?.split(" as of ")?.[0] !== topic && (Date.now() - lastTopicUpdate) >= 5 * 60 * 1000) {
            lastTopicUpdate = Date.now();
            void channel.setTopic(`${topic} as of <t:${lastTopicUpdate.toString().substring(0, lastTopicUpdate.toString().length-3)}:R>`);
            if(serverStruggling) void channel.send("couldn't check some tiles!");
        }
    });

    scanner.on("grief", (grief) => {
        console.log(grief.templateLocation)
        const tileID = `${grief.templateLocation.tx} ${grief.templateLocation.ty}`;

        if(griefCache[tileID]?.[grief.templateName] === grief.errors) return;
        if(!griefCache[tileID]) griefCache[tileID] = {};
        griefCache[tileID][grief.templateName] = grief.errors;

        const message = `[**${grief.templateName}**](<${wplaceLink(geoCoords(grief.templateLocation))}>) mismatch: ${grief.errors}/${grief.pixels} (~${((grief.errors/grief.pixels)*100).toFixed(1)}%) pixels`;
        grief.snapshot.clone().resize({width: Math.round(grief.width * 3), kernel: "nearest"}).toBuffer().then(image => {
            void channel.send({
                content: message,
                files: [{attachment: image}]
            })
        }).catch(e => {
            console.error(e);
            void channel.send(`${message}\n-# Snapshot rendering failed for some reason >.>`)
        })
    })
    scanner.on("clean", (grief) => {
        const tileID = `${grief.templateLocation.tx} ${grief.templateLocation.ty}`;

        if(!griefCache[tileID]) griefCache[tileID] = {};
        if(griefCache[tileID][grief.templateName] > 0) void channel.send(`[**${grief.templateName}**](<${wplaceLink(geoCoords(grief.templateLocation))}>) is clean again`);

        griefCache[tileID][grief.templateName] = 0;
    })
}

void client.login(env.get("DISCORD_TOKEN").required().asString());