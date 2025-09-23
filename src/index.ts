import "dotenv/config";
import * as env from 'env-var';
import Scanner from "./scanner";
import {Client, Events, GatewayIntentBits, ChannelType, ActivityType} from "discord.js";
import {findManagedMessage, griefList, templateLink, templateStats} from "./utils";

const client = new Client({intents: [GatewayIntentBits.Guilds]})
const alertOnBoot = env.get("ALERT_ON_BOOT").asBool();
let bootScan = true;

client.once(Events.ClientReady, (client) => {
    console.log(`Hewwo~ I'm logged in as ${client.user.username} :3`);
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
    scanner.on("scannedAll", (counts) => {
        bootScan = false;

        const trueTileCount = Object.keys(counts.griefCache).length;
        const serverStruggling = counts.scannedTileCount !== trueTileCount;

        const topic = serverStruggling ? "Couldn't check some tiles" : `Checking ${counts.scannedTileCount} tiles against ${counts.scannedTemplateCount} templates • ${counts.mismatches}/${counts.pixels} mismatched pixels`;
        const now = Date.now();
        if(channel.topic?.split(" as of ")?.[0] !== topic && (now - lastTopicUpdate) >= 5 * 60 * 1000) {
            lastTopicUpdate = now;
            void channel.setTopic(`${topic} as of <t:${lastTopicUpdate.toString().substring(0, lastTopicUpdate.toString().length-3)}:R>`);
            if(serverStruggling) void channel.send("couldn't check some tiles!");
        }

        if(!client.user) return; // stupid typescript
        const overview = griefList(counts.griefCache);
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
}

void client.login(env.get("DISCORD_TOKEN").required().asString());