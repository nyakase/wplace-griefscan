import "dotenv/config";
import * as env from 'env-var';
import Scanner from "./scanner";
import {Client, Events, GatewayIntentBits, ChannelType, ActivityType} from "discord.js";
import {dataFromFilename, findManagedMessage, geoCoords, griefList, templateLink, templateStats, wplaceLink} from "./utils";
import ejs from "ejs";
import { join } from "node:path";

const client = new Client({intents: [GatewayIntentBits.Guilds]})
const alertOnBoot = env.get("ALERT_ON_BOOT").asBool();
const webPort = env.get("WEBSITE_PORT").asPortNumber();
const webBase = env.get("WEBSITE_BASEURL").asString();
const fsBase = env.get("FILESERVER_BASEURL").asString();
const scanner = new Scanner();
let bootScan = true;

client.once(Events.ClientReady, (client) => {
    console.log(`Hewwo~ I'm logged in as ${client.user.username} :3`);
    client.user.setPresence({activities: [{type: ActivityType.Watching, name: "your pixels"}]})

    void startWebsite();
    void startScanner();
})

async function startScanner() {
    const channel = await client.channels.fetch(env.get("DISCORD_CHANNEL").required().asString());
    if(channel?.type !== ChannelType.GuildText) throw new Error("The channel must be a regular text channel in a server.");

    const overviewChannel = await client.channels.fetch(env.get("DISCORD_OVERVIEW_CHANNEL").required().asString());
    if(overviewChannel?.type !== ChannelType.GuildText) throw new Error("The overview channel must be a regular text channel in a server.>");

    let lastTopicUpdate = 0; // lol
    scanner.start();
    scanner.on("scannedAll", (counts) => {
        bootScan = false;
        const serverStruggling = counts.trueTileCount > counts.scannedTileCount;
        const tempsStruggling = !serverStruggling && (counts.trueTemplateCount > counts.scannedTemplateCount);
        const alreadyStruggling = channel.topic && channel.topic.includes("⚠️")

        const topic = `Checking ${counts.scannedTileCount}${serverStruggling?` (⚠️ not ${counts.trueTileCount}) `:" "}tiles against ${counts.scannedTemplateCount}${tempsStruggling?` (⚠️ not ${counts.trueTemplateCount}) `:" "}templates • ${counts.mismatches}/${counts.pixels} mismatched pixels`;
        const now = Date.now();
        if(channel.topic?.split(" as of ")?.[0] !== topic && (now - lastTopicUpdate) >= 5 * 60 * 1000) {
            lastTopicUpdate = now;
            if(serverStruggling && !alreadyStruggling) void channel.send(`⚠️ some tiles couldn't be downloaded`);
            if(tempsStruggling && !alreadyStruggling) void channel.send(`⚠️ some templates couldn't be compared`);
            void channel.setTopic(`${topic} as of <t:${lastTopicUpdate.toString().substring(0, lastTopicUpdate.toString().length-3)}:R>`);
        }

        if(!client.user) return; // stupid typescript
        const {topText, bottomText} = griefList(counts.griefCache);
        const stamp = counts.griefCache.writtenAt ? `\n-# as of <t:${counts.griefCache.writtenAt.getTime().toString().substring(0, now.toString().length-3)}:R>` : "";
        findManagedMessage(overviewChannel, client.user.id).then(message => {
            if(!message) {
                void overviewChannel.send(topText+stamp);
            } else if (message.content.split("\n-# as of")?.[0] !== topText) {
                void message.edit(topText+stamp);
            }
        }).catch(e => {
            console.error(e);
        })

        findManagedMessage(overviewChannel, client.user.id, 1).then(message => {
            if(message && !bottomText) return void message.delete();
            if(!bottomText) return;
            
            if(!message) {
                void overviewChannel.send(bottomText+stamp);
            } else if (message.content.split("\n-# as of")?.[0] !== bottomText) {
                void message.edit(bottomText+stamp);
            }
        }).catch(e => {
            console.error(e);
        })
    });

    scanner.on("newGrief", (grief) => {
        if(bootScan && !alertOnBoot) return;

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
    scanner.on("newClean", (grief) => {
        void channel.send(`🦭 ${templateLink(grief.template)} is clean again`);
    })
    scanner.on("templateChange", (e) => {
        void channel.send(`🔄 ${templateLink(e.template)} was updated`);
    })
}

function startWebsite() {
    if(!webPort || !webBase) return;
    Bun.serve({
        port: webPort,
        async fetch(req) {
            if(!scanner.griefCache.writtenAt) return new Response("Come back later, the scanner needs to complete its first scan.", {status: 500});

            const pathname = new URL(req.url).pathname;
            const forFile = pathname.endsWith(".png");

            const coreTemplate = dataFromFilename(`${decodeURI(pathname.slice(1))}${!forFile ? ".png" : ""}`);
            if(!coreTemplate) return new Response("Sorry, couldn't find that page.", {status: 404});
            const templateFile = scanner.templateFile(coreTemplate);
            if(!templateFile) return new Response("Sorry, couldn't find that template.", {status: 404});

            if(forFile) {
                if(fsBase) return Response.redirect(`${fsBase}${pathname}`);
                return new Response(new Uint8Array(await templateFile.toBuffer()), {headers: {
                    "Access-Control-Allow-Origin": "*", "Content-Disposition": "inline", "Content-Type": "image/png"}});
            }

            return new Response(await ejs.renderFile(join(__dirname, "web/template.ejs"), {coreTemplate,
                fileURL: `${fsBase || ""}${pathname}.png`,
                wplaceURL: wplaceLink(geoCoords(coreTemplate.location)),
            }), {headers: {"Content-Type": "text/html"}});
        }
    })
}

void client.login(env.get("DISCORD_TOKEN").required().asString());