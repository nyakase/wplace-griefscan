import "dotenv/config";
import * as env from 'env-var';
import Scanner from "./scanner";
import {Client, Events} from "discord.js";

const client = new Client({intents: [1]})
let griefCache = {};

client.once(Events.ClientReady, (client) => {
    console.log(`Yo! Logged in as ${client.user.username}`);

    const scanner = new Scanner();
    scanner.on("grief", async (grief) => {
        if(griefCache[grief.tile]?.[grief.name] > grief.errors) return;
        if(!griefCache[grief.tile]) griefCache[grief.tile] = {};
        griefCache[grief.tile][grief.name] = grief.errors;

        const image = await grief.image.clone().resize({width: Math.round(grief.width * 3), kernel: "nearest"}).toBuffer();

        client.channels.fetch(env.get("DISCORD_CHANNEL").required().asString())
            .then(channel => channel.send({content: `**${grief.name}** mismatch: ${grief.errors}/${grief.pixels} pixels`,
                    files: [{attachment: image}]}))
    })
    scanner.on("clean", (grief) => {
        if(!griefCache[grief.tile]) griefCache[grief.tile] = {};
        if(griefCache[grief.tile][grief.name] > 0) client.channels.fetch(env.get("DISCORD_CHANNEL").required().asString())
            .then(channel => channel.send(`**${grief.name}** is clean again`))

        griefCache[grief.tile][grief.name] = 0;
    })
})

client.login(env.get("DISCORD_TOKEN").required().asString());