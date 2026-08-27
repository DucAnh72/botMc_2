let menuTimeout = null;

const http = require("http");

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is alive!");
}).listen(3000, "0.0.0.0");

const { Client, GatewayIntentBits } = require("discord.js");

const mineflayer = require("mineflayer");

const config = require("./config.json");

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});
discordClient.once("clientReady", () => {
    console.log(`[Discord] ${discordClient.user.tag} đã online`);
});
discordClient.login(process.env.DISCORD_TOKEN);


const fs = require("fs");
const https = require("https");

let currentSign = null;

let bot_args = {
    host: process.env.host,
    port: process.env.port,
    username: process.env.username,
    version: config.version,
    respawn: config.respawn,
};

let loginMessageCount = 0;

let reconnecting = false;
let wAfkInterval = null;
let reportInterval = null;
let startTime = null;
let orderInterval = null;
let wasKicked = false;
clearInterval(orderInterval);
const CHANNEL_ID = config.Idchannel;

// Hàm tính toán thời gian đã treo máy (Uptime)
function getUptimeString() {
    if (!startTime) return "0 phút";
    const diffMs = Date.now() - startTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) {
        return `${diffHours} giờ ${diffMins % 60} phút`;
    }
    return `${diffMins} phút`;
}

// Hàm gửi tin nhắn tới Discord Webhook
function sendDiscordWebhook(content) {
    if (!config.webhookUrl || config.webhookUrl.trim() === "") return;

    const cleanUrl = config.webhookUrl.trim();
    const data = JSON.stringify({
        username: config.username || "Mineflayer Bot",
        content: content,
    });

    const url = new URL(cleanUrl);
    const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
        },
    };

    const req = https.request(options, (res) => {
        if (res.statusCode >= 400) {
            console.error(
                `[!] Discord Webhook từ chối gửi. Mã lỗi: ${res.statusCode}`,
            );
        }
    });

    req.on("error", (error) => {
        console.error("[!] Lỗi kết nối mạng khi gửi Webhook Discord:", error);
    });

    req.write(data);
    req.end();
}

let bot;
function start_bot() {
    if (bot) {
        console.log(
            "[!] Bot đang có một kết nối hiện tại, bỏ qua lần khởi động trùng.",
        );
        return;
    }

    //console.log('[+] Đang start bot...')
    const botInstance = mineflayer.createBot(bot_args);
    bot = botInstance;
    botInstance._client.on("packet", (data, meta) => {
        if (meta.name === "open_sign_entity") {
            currentSign = data;
        }
    });
    loginMessageCount = 0;
    console.log(` ${process.env.username}`);
    botInstance.once("login", () => {
        console.log("Logged in");
        const loginTimer = setTimeout(() => {
            // Do not send a delayed command from an old connection to a new one.
            if (bot !== botInstance) return;
            botInstance.chat(`/dn ${config.botPassword}`);
            console.log("[+] Đã Gửi Lệnh Đăng Nhập");
        }, 1000);

        botInstance.once("end", () => clearTimeout(loginTimer));
    });

    bot.on("spawn", () => {
        console.log("Đăng Nhập Thành Công");

        if (!startTime) startTime = Date.now();

        sendDiscordWebhook(
            `🟢 **${config.username}** đã kết nối và đăng nhập thành công vào server!`,
        );

        // Báo cáo tự động mỗi 5 phút (300000 ms)
        clearInterval(reportInterval);
        reportInterval = setInterval(() => {
            const uptime = getUptimeString();
            const statusMsg = `📈 **[BÁO CÁO ĐỊNH KỲ]**\n👤 Bot: **${config.username}**\n⏱️ Thời gian đã treo: \`${uptime}\`\n❤️ Máu hiện tại: \`${Math.round(bot.health || 20)}\`\n🍖 Thức ăn: \`${Math.round(bot.food || 20)}\``;
            console.log(statusMsg.replace(/\*\*/g, ""));
            sendDiscordWebhook(statusMsg);
        }, 300000);
    });

    bot.on("entityHurt", (entity) => {
        if (entity === bot.entity) {
            const uptime = getUptimeString();
            const msg = `⚠️ **[CẢNH BÁO]** **${config.username}** đang bị tấn công hoặc nhận sát thương! (Đã treo được: \`${uptime}\`)`;
            console.log(`[!] ${msg.replace(/\*\*/g, "")}`);
            sendDiscordWebhook(msg);
        }
    });

    bot.on("death", () => {
        const uptime = getUptimeString();
        console.log("im dead");
        sendDiscordWebhook(
            `💀 **${config.username}** đã bị tiêu diệt! (Thời gian đã sống: \`${uptime}\`) -> Đang chờ hồi sinh...`,
        );

        let delay = Math.floor(Math.random() * 10000);
        console.log(`Respawning in ${delay}...`);
        setTimeout(() => {
            bot.respawn();
        }, delay);
    });
    bot.on("error", (err) => {
        console.error("Lỗi bot:", err);
        sendDiscordWebhook(
            `❌ **[LỖI BOT]** Bot gặp lỗi: \`${err.message}\` (Thời gian đã treo: \`${getUptimeString()}\`)`,
        );
    });
    // --- ĐÃ SỬA LỖI AN TOÀN TẠI ĐÂY ---
    bot.on("kicked", (reason) => {
        stopAllTasks();
        wasKicked = true;

        const uptime = getUptimeString();

        let reasonClean = "Không rõ lý do";

        try {
            if (typeof reason === "string") {
                reasonClean = reason;
            } else if (reason?.value?.text?.value) {
                reasonClean = reason.value.text.value;
            } else {
                reasonClean = JSON.stringify(reason);
            }
        } catch (e) {
            reasonClean = String(reason);
        }
        const msg = `🔴 **[BỊ KICK]** **${config.username}** đã bị đuổi khỏi server!.
    💬 Lý do: \`${reasonClean}\`
    ⏱️ Tổng thời gian đã treo trước đó: \`${uptime}\``;

        console.log(msg.replace(/\*\*/g, ""));
        sendDiscordWebhook(msg);
    });
    botInstance.on("messagestr", (message, messagePosition) => {

        console.log(`[${message}]${messagePosition}`);
        if (message.includes("Đăng nhập thành công")) {
            loginMessageCount++;

            if (loginMessageCount >= 2) {
                console.log("[+] Đủ điều kiện mở menu");
                setTimeout(() => {
                    menu(botInstance);
                }, 2000);
            }
        }
        if (message.includes("Bạn đã đăng nhập")) {
            if (loginMessageCount < 2) {
                setTimeout(() => {
                    menu();
                }, 2000);
            }
        }
        if (message.includes("Vui lòng chờ 1 giây rồi")) {
            setTimeout(() => {
                menu(botInstance);
            }, 4000);
        }
        const msgLower = message.toLowerCase();
        if (
            msgLower.includes("banned") ||
            msgLower.includes("bị khóa tài khoản") ||
            msgLower.includes("ban lệnh")
        ) {
            const uptime = getUptimeString();
            sendDiscordWebhook(
                `🚫 **[CẢNH BÁO BAN]** Phát hiện tin nhắn nghi ngờ Bot bị BAN:\n\`${message}\`\n⏱️ Thời gian đã treo: \`${uptime}\``,
            );
        }
    });

    botInstance.on("end", () => {
        stopAllTasks();
        clearInterval(reportInterval);
        if (bot !== botInstance) return;
        bot = null;
        if (reconnecting) return;
        reconnecting = true;
        if (wasKicked) {
            wasKicked = false;
            console.log(
                "Bot đã bị kick khỏi server. Đang tiến hành kết nối lại sau 10 giây...",
            );
        } else {
            const uptime = getUptimeString();
            console.log("Disconnected");
            console.log("[+] Kết Nối Lại Sau 10s");
            sendDiscordWebhook(
                `⚠️ **${config.username}** bị mất kết nối! (Thời gian đã treo trước đó: \`${uptime}\`). Đang tiến hành kết nối lại sau 10 giây...`,
            );
        }
        startTime = null;

        setTimeout(() => {
            reconnecting = false;
            start_bot();
        }, 7000);
    });
}

function stopAllTasks() {
    clearInterval(orderInterval);
    orderInterval = null;

    clearTimeout(menuTimeout);
    menuTimeout = null;
}
function exitBot() {
    reconnecting = true;
    clearInterval(reportInterval);

    stopAllTasks();
    console.log("[+] Bot đã chủ động thoát game.");
    const uptime = getUptimeString();
    sendDiscordWebhook(
        `🔴 **${config.username}** đã chủ động thoát game. (Tổng thời gian đã treo: \`${uptime}\`)`,
    );
    startTime = null;
    const currentBot = bot;
    bot = null;
    currentBot?.quit();
}
function stopafk() {
    if (wAfkInterval) {
        clearInterval(wAfkInterval);
        wAfkInterval = null;

        const uptime = getUptimeString();
        const msg = `⏹️ **[AFK]** Đã tắt AFK Quay đầu (WAFK) (Tổng thời gian đã treo: \`${uptime}\`)`;
        console.log("[-] " + msg.replace(/\*\*/g, ""));
        sendDiscordWebhook(msg);
    } else {
        console.log("[!] AFK hiện đang không bật.");
    }
}
function wafk() {
    clearInterval(wAfkInterval);

    let yaw = 0;
    wAfkInterval = setInterval(() => {
        yaw += 0.5;
        bot.look(yaw, 0, true);
    }, 500);

    const uptime = getUptimeString();
    const msg = `🔄 **[AFK]** Đã bật AFK Quay đầu (WAFK) (Thời gian đã treo: \`${uptime}\`)`;
    console.log("[+] " + msg.replace(/\*\*/g, ""));
    sendDiscordWebhook(msg);
}

function shard() {
    bot.chat("/afk");
    setTimeout(() => {
        bot.clickWindow(3, 0, 0);
    }, 1000);
}
function status() {
    //console.log(`${config.username}`);
    const uptime = getUptimeString();
    const statusMsg = `📈 **[BÁO CÁO THỦ CÔNG]**\nbot::${config.username} \n👤 Bot: **${config.username}**\n⏱️ Thời gian đã treo: \`${uptime}\`\n❤️ Máu hiện tại: \`${Math.round(bot.health || 20)}\`\n🍖 Thức ăn: \`${Math.round(bot.food || 20)}\``;
    console.log("[+] " + statusMsg.replace(/\*\*/g, ""));
    sendDiscordWebhook(statusMsg);
}

function menu(targetBot = bot) {
    if (!targetBot || bot !== targetBot) return;

    clearTimeout(menuTimeout);
    targetBot.chat("/menu");
    menuTimeout = setTimeout(() => {
        if (bot !== targetBot) return;
        targetBot.clickWindow(24, 0, 0);
        console.log("[+] Đang Vào KingSMP");
        menuTimeout = null;
    }, 1000);
}
function startOrder(slotnumber) {
    clearInterval(orderInterval);

    orderInterval = setInterval(() => {
        currentSign = null;

        bot.chat("/order");

        setTimeout(() => {
            bot.clickWindow(51, 0, 0);
        }, 500);

        setTimeout(() => {
            bot.clickWindow(slotnumber, 0, 0);
        }, 1000);

        setTimeout(() => {
            bot.clickWindow(14, 0, 0);
        }, 1500);

        setTimeout(() => {
            if (!currentSign) {
                console.log("[!] Hết item");
                sendDiscordWebhook(
                    `🔄 **[AUTO ORDER]** Hết item (Thời gian đã treo: \`${getUptimeString()}\`)`,
                );
                stopOrder();
                return;
            }

            bot._client.write("update_sign", {
                location: currentSign.location,
                isFrontText: true,
                text1: `${config.orderamount}`,
                text2: "",
                text3: "",
                text4: "",
            });
        }, 2900);
    }, 60000);
    sendDiscordWebhook(
        `🔄 **[AUTO ORDER]** Đã bật auto order (Thời gian đã treo: \`${getUptimeString()}\`)`,
    );
    console.log("[+] Auto Order ON");
}

function stopOrder() {
    clearInterval(orderInterval);

    orderInterval = null;

    console.log("[+] Auto Order OFF");
    sendDiscordWebhook(
        `🔄 **[AUTO ORDER]** Đã tắt auto order (Thời gian đã treo: \`${getUptimeString()}\`)`,
    );
}

function restartBot() {
    reconnecting = true;
    stopAllTasks();
    const currentBot = bot;
    bot = null;
    currentBot?.quit();

    setTimeout(() => {
        reconnecting = false;

        start_bot();
    }, 3000);
}
async function executeCommand(message, command) {
    const replyHandler = async (serverMessage) => {
        clearTimeout(timeout);

        await message.reply(`📩 ${serverMessage}`);
    };

    bot.once("messagestr", replyHandler);

    bot.chat(command);

    const timeout = setTimeout(() => {
        bot.removeListener("messagestr", replyHandler);

        message.reply("⚠️ Không nhận được phản hồi từ server");
    }, 3000);
}

async function showitem(message, slot) {
    bot.chat("/order");

    setTimeout(() => {
        bot.clickWindow(51, 0, 0);
    }, 500);
    setTimeout(async () => {
        const item = bot.currentWindow?.slots[slot];

        const log = `📦 Item in slot ${slot}: ${
            item ? item.displayName : "Empty"
        }`;

        await message.reply(log);
    }, 1000);
}
// Lắng nghe tin nhắn từ Discord

discordClient.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    //console.log(CHANNEL_ID);
    if ((message.channel.id) !== CHANNEL_ID) return;
    if (message.author.id !== config.discordOwnerId) return;

    const cmd = message.content.toLowerCase();
    if (cmd === "help") {
        await message.reply(
            "Các lệnh có sẵn:\n- test: Thử lệnh /ah sell\n- shard: Thực hiện lệnh /afk và click shard\n- status: Báo cáo trạng thái bot\n- menu: Mở menu\n- wafk: Bật AFK quay đầu\n- stop: Tắt AFK quay đầu\n- cmd <lệnh>: Thực hiện lệnh trong game\n- exit: Thoát bot\n- restart: Restart bot\n- order: Bật Auto Order\n- sorder: Tắt Auto Order",
        );
    }
    if (cmd === "test") {
        const text = "/ah sell";
        executeCommand(message, text);
    }

    if (cmd === "shard") {
        shard();
        await message.reply("Đang dịch chuyển đến warp afk4");
    }
    if (cmd === "status") {
        status();
    }
    if (cmd === "menu") {
        menu(bot);
        await message.reply("Đã thực hiện menu");
    }
    if (cmd === "wafk") {
        wafk();
        await message.reply("Đã bật WAFK");
    }
    if (cmd === "stop") {
        stopafk();
        await message.reply("Đã tắt WAFK");
    }

    if (cmd.startsWith("cmd ")) {
        const text = message.content.slice(4);
        executeCommand(message, text);
    }

    if (cmd === "exit") {
        exitBot();
        await message.reply("Đã thoát bot");
    }

    if (cmd === "restart") {
        restartBot();
        await message.reply("Đang restart");
    }
    if (cmd.startsWith("click ")) {
        const slotC = Number(message.content.slice(6));
        if (bot.currentWindow) {
            await bot.clickWindow(slotC, 0, 0);
            await message.reply("Đã click vào WindowSlot ${slotC}: $");
        } else {
            await message.reply("Không có cửa sổ nào đang mở");
        }
    }
    if (cmd.startsWith("show ")) {
        const slot = Number(message.content.slice(5));
        showitem(message, slot);
    }
    if (cmd.startsWith("order ")) {
        const slot2 = Number(message.content.slice(6));
        startOrder(slot2);
        await message.reply("Đã bật Auto Order");
    }
    if (cmd === "sorder") {
        stopOrder();
        await message.reply("Đã tắt Auto Order");
    }
});
start_bot();
