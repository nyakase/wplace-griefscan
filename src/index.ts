import "dotenv/config";
import * as env from 'env-var';
import Scanner from "./scanner";
import {Client, Events} from "discord.js";

const client = new Client({intents: [1]})
type GriefCache = Record<string, Record<string, number>>;
let griefCache: GriefCache = {};

client.once(Events.ClientReady, (client) => {
    console.log(`Yo! Logged in as ${client.user.username}`);
    client.user.setPresence({activities: [{type: 3, name: "your pixels"}]})

    const scanner = new Scanner();
    scanner.on("load", async (counts) => {
        client.channels.fetch(env.get("DISCORD_CHANNEL").required().asString())
            .then(channel => {
                channel.setTopic(`Checking ${counts.tiles} tiles with ${counts.templates} templates every minute`);
            })
    })
    scanner.on("grief", async (grief) => {
        if(griefCache[grief.tile]?.[grief.name] === grief.errors) return;
        if(!griefCache[grief.tile]) griefCache[grief.tile] = {};
        griefCache[grief.tile][grief.name] = grief.errors;

        const image = await grief.image.clone().resize({width: Math.round(grief.width * 3), kernel: "nearest"}).toBuffer();

        client.channels.fetch(env.get("DISCORD_CHANNEL").required().asString())
            .then(channel => {
                if(channel?.isSendable()) { channel.send({
                    content: `**${grief.name}** mismatch: ${grief.errors}/${grief.pixels} (~${Math.round((grief.errors/grief.pixels)*100)}%) pixels`,
                    files: [{attachment: image}]
                }) } else {
                    throw "Channel doesn't support sending messages >.>"
                }
            })
    })
    scanner.on("clean", (grief) => {
        if(!griefCache[grief.tile]) griefCache[grief.tile] = {};
        if(griefCache[grief.tile][grief.name] > 0)
            client.channels.fetch(env.get("DISCORD_CHANNEL").required().asString())
                .then(channel => {
                    if(channel?.isSendable()) { channel.send(
                        `**${grief.name}** is clean again`,
                    ) } else {
                        throw "Channel doesn't support sending messages >.>"
                    }
                })

        griefCache[grief.tile][grief.name] = 0;
    })
})

client.login(env.get("DISCORD_TOKEN").required().asString());