import "dotenv/config";
import * as env from 'env-var';
import Scanner from "./scanner";
import {Client, Events, GatewayIntentBits, ChannelType, ActivityType} from "discord.js";

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
    scanner.on("load", (counts) => {
        void channel.setTopic(`Checking ${counts.tiles} tiles against ${counts.templates} templates every minute`);
    })
    scanner.on("grief", (grief) => {
        if(griefCache[grief.tileID]?.[grief.templateName] === grief.errors) return;
        if(!griefCache[grief.tileID]) griefCache[grief.templateName] = {};
        griefCache[grief.tileID][grief.templateName] = grief.errors;

        grief.snapshot.clone().resize({width: Math.round(grief.width * 3), kernel: "nearest"}).toBuffer().then(image => {
            void channel.send({
                content: `**${grief.templateName}** mismatch: ${grief.errors}/${grief.pixels} (~${((grief.errors/grief.pixels)*100).toFixed(1)}%) pixels`,
                files: [{attachment: image}]
            })
        }).catch(e => {
            console.error(e);
            void channel.send(`**${grief.templateName}** mismatch: ${grief.errors}/${grief.pixels} (~${((grief.errors/grief.pixels)*100).toFixed(1)}%) pixels\n-# Snapshot rendering failed for some reason >.>`)
        })
    })
    scanner.on("clean", (grief) => {
        if(!griefCache[grief.tileID]) griefCache[grief.tileID] = {};
        if(griefCache[grief.tileID][grief.templateName] > 0) void channel.send(`**${grief.templateName}** is clean again`);

        griefCache[grief.tileID][grief.templateName] = 0;
    })
}

void client.login(env.get("DISCORD_TOKEN").required().asString());