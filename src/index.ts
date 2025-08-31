import "dotenv/config";
import * as env from 'env-var';
import Scanner, {CoreTemplate} from "./scanner";
import {Client, Events, GatewayIntentBits, ChannelType, ActivityType} from "discord.js";
import {findManagedMessage, griefList, templateLink, templateStats} from "./utils";

const client = new Client({intents: [GatewayIntentBits.Guilds]})
export type GriefCache = Record<string, Record<string, {errors: number, template: CoreTemplate}>>;
const griefCache: GriefCache = {};

client.once(Events.ClientReady, (client) => {
    console.log(`Yo! Logged in as ${client.user.username}`);
    client.user.setPresence({activities: [{type: ActivityType.Watching, name: "your pixels"}]})

    void startScanner();
})

async function startScanner() {
    const channel = await client.channels.fetch(env.get("DISCORD_CHANNEL").required().asString());
    if(channel?.type !== ChannelType.GuildText) throw new Error("Can't send messages in the channel >.>");

    const overviewChannel = await client.channels.fetch(env.get("DISCORD_OVERVIEW_CHANNEL").required().asString());
    if(overviewChannel?.type !== ChannelType.GuildText) throw new Error("Can't send messages in the overview channel >.>");

    const scanner = new Scanner();
    let lastTopicUpdate = 0; // lol
    scanner.on("scanned", (counts) => {
        const serverStruggling = counts.trueTileCount !== counts.tileCount;

        const topic = serverStruggling ? "Couldn't check some tiles" : `Checking ${counts.tileCount} tiles against ${counts.templateCount} templates • ${counts.errors}/${counts.pixels} mismatched pixels`;
        const now = Date.now();
        if(channel.topic?.split(" as of ")?.[0] !== topic && (now - lastTopicUpdate) >= 5 * 60 * 1000) {
            lastTopicUpdate = now;
            void channel.setTopic(`${topic} as of <t:${lastTopicUpdate.toString().substring(0, lastTopicUpdate.toString().length-3)}:R>`);
            if(serverStruggling) void channel.send("couldn't check some tiles!");
        }

        if(!client.user) return; // stupid typescript
        const overview = griefList(griefCache);
        const stampedOverview = `${overview}\n-# as of <t:${now.toString().substring(0, now.toString().length-3)}:R>`
        findManagedMessage(overviewChannel, client.user.id).then(message => {
            if(!message) {
                void overviewChannel.send(stampedOverview);
            } else if (message.content.split("\n-# as of")?.[0] !== overview) {
                void message.edit(stampedOverview);
            }
        }).catch(e => {
            console.error(e);
        })
    });

    scanner.on("grief", (grief) => {
        const tileID = `${grief.template.location.tx} ${grief.template.location.ty}`;
        const tempID = `${grief.template.location.px} ${grief.template.location.py} ${grief.template.name}`;

        if(griefCache[tileID]?.[tempID]?.errors === grief.errors) return;
        if(!griefCache[tileID]) griefCache[tileID] = {};
        griefCache[tileID][tempID] = {errors: grief.errors, template: grief.template};

        const message = templateStats(grief);
        grief.snapshot.clone().resize({width: Math.round(grief.width * 3), kernel: "nearest"}).toBuffer().then(image => {
            void channel.send({
                content: message,
                files: [{attachment: image}]
            })
        }).catch(e => {
            console.error(e);
            void channel.send(`${message}\n-# Snapshot rendering failed for some reason >.>`);
        })
    })
    scanner.on("clean", (grief) => {
        const tileID = `${grief.template.location.tx} ${grief.template.location.ty}`;
        const tempID = `${grief.template.location.px} ${grief.template.location.py} ${grief.template.name}`;

        if(!griefCache[tileID]) griefCache[tileID] = {};
        if(griefCache[tileID][tempID]?.errors > 0) void channel.send(`${templateLink(grief.template)} is clean again`);

        griefCache[tileID][tempID] = {errors: 0, template: grief.template};
    })
}

void client.login(env.get("DISCORD_TOKEN").required().asString());