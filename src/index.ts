import "dotenv/config";
import * as env from 'env-var';
import Scanner from "./scanner";
import {Client, Events, GatewayIntentBits, ChannelType, ActivityType} from "discord.js";

const client = new Client({intents: [GatewayIntentBits.Guilds]})
type GriefCache = Record<string, Record<string, number>>;
let griefCache: GriefCache = {};

client.once(Events.ClientReady, async (client) => {
    console.log(`Yo! Logged in as ${client.user.username}`);
    client.user.setPresence({activities: [{type: ActivityType.Watching, name: "your pixels"}]})

    const channel = await client.channels.fetch(env.get("DISCORD_CHANNEL").required().asString());
    if(channel?.type !== ChannelType.GuildText) throw "Can't send messages in the channel >.>"

    const scanner = new Scanner();
    scanner.on("load", async (counts) => {
        channel.setTopic(`Checking ${counts.tiles} tiles with ${counts.templates} templates every minute`);
    })
    scanner.on("grief", async (grief) => {
        if(griefCache[grief.tile]?.[grief.name] === grief.errors) return;
        if(!griefCache[grief.tile]) griefCache[grief.tile] = {};
        griefCache[grief.tile][grief.name] = grief.errors;

        const image = await grief.image.clone().resize({width: Math.round(grief.width * 3), kernel: "nearest"}).toBuffer();

        channel.send({
            content: `**${grief.name}** mismatch: ${grief.errors}/${grief.pixels} (~${((grief.errors/grief.pixels)*100).toFixed(1)}%) pixels`,
            files: [{attachment: image}]
        })
    })
    scanner.on("clean", (grief) => {
        if(!griefCache[grief.tile]) griefCache[grief.tile] = {};
        if(griefCache[grief.tile][grief.name] > 0) channel.send(`**${grief.name}** is clean again`)

        griefCache[grief.tile][grief.name] = 0;
    })
})

client.login(env.get("DISCORD_TOKEN").required().asString());