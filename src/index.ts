import { Context, Schema, h } from 'koishi'
import { } from 'koishi-plugin-smmcat-localstorage';
import { pathToFileURL } from 'url'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { Readable } from 'stream'

export const name = 'smmcat-feedback'

export interface Config {
  atQQ: boolean
  adminQQ: string[]
  downloadPath: string
  weightUp: string[]
  refuseWord: string[]
  filterWord: string[]
  pageDisplay: number
  waitTime: number
  textMaxLen: number
  imgMaxLen: number
  email: string
  badWebLink: boolean
  picDetection: boolean
  filter: string[]
  textfilter: string[]
  textDetaction: boolean
  Appid: string
  key: string
}

export const inject = {
  required: ['localstorage']
}

export const Config: Schema<Config> = Schema.object({
  atQQ: Schema.boolean().default(false).description("回复消息附带 @发送者 [兼容操作]"),
  adminQQ: Schema.array(String).role("table").default([]).description("审核管理员QQ或标识码列表"),
  weightUp: Schema.array(String).role("table").default(["炸了", "坏了", "失效"]).description("关键词权重提升"),
  refuseWord: Schema.array(String).role("table").default(["臭smm"]).description("当检测到关键字，拒绝提交"),
  filterWord: Schema.array(String).role("table").default(["臭smm"]).description("当检测到关键字，过滤提交"),
  downloadPath: Schema.string().default("./data/smmfeedback/").description("图片保存位置"),
  pageDisplay: Schema.number().default(10).description("目录每页显示数量"),
  waitTime: Schema.number().default(120000).description("每次提交反馈需要等待的时间(毫秒)"),
  textMaxLen: Schema.number().default(500).description("反馈内容的文本最大长度"),
  imgMaxLen: Schema.number().default(1).description("反馈附带的图片最大数量"),
  email: Schema.string().default("").description("有反馈提醒发送机器人作者的的邮箱（为空则不做邮件提醒）"),
  badWebLink: Schema.boolean().default(true).description("屏蔽反馈中存在的网页链接（兼容官方qqbot显示）"),
  picDetection: Schema.boolean().default(false).description("开启不良图像检测"),
  filter: Schema.array(String).role("table").default([
    "ACGPorn", "ButtocksExposed", "WomenSexyChest",
    "WomenSexy", "ACGSexy", "SexualGoods",
    "Porn", "PornSum", "Sexy"
  ]).description("图像要检测的词条"),
  textDetaction: Schema.boolean().default(true).description("开启不良文本检测"),
  textfilter: Schema.array(String).role("table").default([
    "Abuse", "Illegal", "Spam",
    "Terror", "Porn", "Polity", "Ad"
  ]).description("文本要检测的词条"),
  Appid: Schema.string().default("").description("不良图像&不良文本 Api-Appid [加群申请](https://qm.qq.com/q/Ghom0pXQYK)"),
  key: Schema.string().default("").description("不良图像&不良文本 密钥")
})

export const USAGE = `
**所有指令**

/反馈 上页  
/反馈 下页
/反馈 回执
/反馈 完成  管理员完成工单后输入 (指令已隐藏)
/反馈 待办  管理员查看未完成工单 (指令已隐藏)
/反馈 提交
/反馈 查看
/反馈 留言  管理员对工单进行留言 (指令已隐藏)
/反馈 跳页
`

export function apply(ctx: Context, config: Config) {
  const feedback = {
    useridList: {},
    // 发送反馈信息
    async setFeekback(userId, msg, imgList = []) {
      const userData = JSON.parse(await ctx.localstorage.getItem(`smmFeedback/${userId}`) || "[]");
      const imgUpathList = [];
      if (imgList.length) {
        const type = { ok: 0, err: 0 };
        const eventList = imgList.map((item) => {
          return new Promise(async (resolve, reject) => {
            try {
              const upath = await tool.downloadImage(item);
              imgUpathList.push(upath);
              type.ok++;
              resolve(true);
            } catch (error) {
              resolve(true);
              type.err++;
            }
          });
        });
        await Promise.all(eventList);
        console.log(`上传用户反馈图片：成功${type.ok}次，失败${type.err}次`);
      }
      const markMsg = {
        time: +new Date(),
        msg,
        userId,
        handle: false,
        up: config.weightUp.includes(msg),
        pic: imgUpathList,
        backMsg: []
      };
      if (config.email) {
        const msgInfo = `用户：${userId} 说：${msg}`;
        ctx.http.post("http://182.92.130.139:8000", { mail: config.email, msg: msgInfo });
      }
      if (config.badWebLink) {
        markMsg.msg = markMsg.msg.replace(/(?:https?:\/\/)?\w+\.\w+/g, " 网页链接 ");
      }

      userData.unshift(markMsg);
      await ctx.localstorage.setItem(`smmFeedback/${userId}`, JSON.stringify(userData));
      return { code: true, msg: markMsg };
    },
    // 查看自己的反馈信息 缩略
    async getMyFeedback(userId, session, at, back = false, resume = false) {
      if (!config.adminQQ.includes(userId) || back) {
        const storeData = JSON.parse(await ctx.localstorage.getItem(`smmFeedback/${userId}`) || "[]");
        const userData = tool.sortFeedbackList(storeData);
        if (resume) {
          this.useridList[userId].content = userData;
          this.useridList[userId].type = 0;
        } else {
          this.useridList[userId] = { page: 0, content: userData, type: 0 };
        }
        if (!userData.length) {
          return { code: true, msg: "您还没提交过任何反馈" };
        }
        const radiusIndex = config.pageDisplay * this.useridList[userId].page;
        const startIndex = this.useridList[userId].page * config.pageDisplay;
        const _userData = userData.slice(radiusIndex, radiusIndex + config.pageDisplay);
        const simplify = _userData.map((item, index) => {
          const handle = item.handle ? "[√]" : "[×]";
          const uindex = " " + (index + 1) + " ";
          const time = "(" + tool.dateFormat(item.time).day + ")";
          const content = item.msg.length > 10 ? item.msg.slice(0, 11) + "..." : item.msg;
          return handle + uindex + time + " " + tool.processLinks(content);
        }).join("\n");
        return {
          code: true,
          msg: "[!] 您提交的反馈如下，打勾的为已作者处理：\n\n" + simplify + `

当前页数(${this.useridList[userId].page + 1}/${Math.ceil(this.useridList[userId].content.length / config.pageDisplay)})
回复 /反馈 查看 下标 查看详情`
        };
      } else {
        await session.send(at + "检测到你是管理员账号，请问是否查看所有历史列表？(是/否)");
        const action = await session.prompt(1e4);
        if (action !== "是") {
          return await this.getMyFeedback(userId, session, at, true);
        } else {
          return await this.adminGetFeedbackList(userId);
        }
      }
    },
    // 查看自己的反馈信息 详细
    async getMyFeedbackDetail(userId, index) {
      await this.checkUserTemp(userId);
      if (!index) {
        return { code: false, msg: `请选择对应下标` };
      }
      index = index - 1;
      if (this.useridList[userId].content.length < index) {
        return { code: false, msg: `当前为第 ${this.useridList[userId].page + 1} 页，您选的下标过大` };
      }
      const uindex = this.useridList[userId].page * config.pageDisplay + index;
      const detailData = this.useridList[userId].content[uindex];
      this.useridList[userId].select = uindex;
      const handle = detailData.handle ? "[已处理] " : "[未处理] ";
      const isRecover = detailData.backMsg?.length ? `有${detailData.backMsg.length} 条回复` : "";
      const time = tool.dateFormat(detailData.time);
      const textMsg = detailData.msg;
      const picMsg = detailData.pic?.map((item) => h.image(item)).join("\n");
      const backMsg = detailData.backMsg?.map((item) => {
        return item.name + "：" + item.msg;
      }).join("\n");
      const content = (picMsg ? `${picMsg}
` : "") + handle + time.day + " " + time.time + (isRecover ? "\n* " + isRecover + " *" : "") + "\n\n" + textMsg + (backMsg ? "\n\n-------------------------\n" + backMsg : "");
      return { code: true, msg: tool.processLinks(content) };
    },
    // 判断用户是否注入缓存
    async checkUserTemp(userId) {
      if (!this.useridList[userId]) {
        const userData = JSON.parse(await ctx.localstorage.getItem(`smmFeedback/${userId}`) || "[]");
        this.useridList[userId] = { content: userData, page: 0, type: 0 };
      }
    },
    // 用户反馈查看 下页
    async getMyFeedbackDownPage(userId, session, at) {
      if (!this.useridList[userId]) {
        return { code: false, msg: "请先发送 /反馈 回执 获取回执列表再使用该指令！" };
      }
      if (this.useridList[userId].page + 1 < Math.ceil(this.useridList[userId].content.length / config.pageDisplay)) {
        this.useridList[userId].page++;
      } else {
        return { code: false, msg: "没有下一页内容" };
      }
      switch (this.useridList[userId].type) {
        case 0:
          return await this.getMyFeedback(userId, session, at, true, true);
        case 1:
          return await this.adminGetFeedbackList(userId, true);
        case 2:
          return await this.adminGetFeedbackWaitList(userId, true);
        default:
          return await this.getMyFeedback(userId, session, at, true, true);
      }
    },
    // 用户反馈查看 上页
    async getMyFeedbackUpPage(userId, session, at) {
      if (!this.useridList[userId]) {
        return { code: false, msg: "请先发送 /反馈 回执 获取回执列表再使用该指令！" };
      }
      if (this.useridList[userId].page + 1 > 1) {
        this.useridList[userId].page--;
      } else {
        return { code: false, msg: "没有上一页内容" };
      }
      switch (this.useridList[userId].type) {
        case 0:
          return await this.getMyFeedback(userId, session, at, true);
        case 1:
          return await this.adminGetFeedbackList(userId, true);
        case 2:
          return await this.adminGetFeedbackWaitList(userId, true);
        default:
          return await this.getMyFeedback(userId, session, at, true);
      }
    },
    // 用户反馈查看 跳页
    async getMyFeedbackJumpPage(userId, index, session, at) {
      if (!this.useridList[userId]) {
        return { code: false, msg: "请先发送 /反馈 回执 获取回执列表再使用该指令！" };
      }
      if (!index) {
        return { code: false, msg: `请选择对应页码值` };
      }
      if (index < Math.ceil(this.useridList[userId].content.length / config.pageDisplay)) {
        this.useridList[userId].page = index;
      } else {
        return { code: false, msg: `没有第${index}页内容` };
      }
      switch (this.useridList[userId].type) {
        case 0:
          return await this.getMyFeedback(userId, session, at, true);
        case 1:
          return await this.adminGetFeedbackList(userId, true);
        case 2:
          return await this.adminGetFeedbackWaitList(userId, true);
        default:
          return await this.getMyFeedback(userId, session, at, true);
      }
    },
    // 管理员查看新反馈历史 
    async adminGetFeedbackList(userId, resume = false) {
      if (!config.adminQQ.includes(userId))
        return { code: false, msg: "您不是管理员，无法使用该指令" };
      const upath = path.join(ctx.localstorage.basePath, "./smmFeedback");
      if (!fs.existsSync(upath)) {
        fs.mkdirSync(upath, { recursive: true });
      }
      const userDir = fs.readdirSync(upath);
      const allUserList = [];
      const eventList = userDir.map((item) => {
        return new Promise(async (resolve, reject) => {
          try {
            const data = JSON.parse(await ctx.localstorage.getItem(`smmFeedback/${item}`) || "[]");
            allUserList.push(...data);
            resolve(true);
          } catch (error) {
            resolve(true);
          }
        });
      });
      await Promise.all(eventList);
      const allSortData = tool.sortFeedbackList(allUserList);
      if (resume) {
        this.useridList[userId].content = allSortData;
        this.useridList[userId].type = 1;
      } else {
        this.useridList[userId] = { page: 0, content: allSortData, type: 1 };
      }
      const radiusIndex = config.pageDisplay * this.useridList[userId].page;
      const _userData = allSortData.slice(radiusIndex, radiusIndex + config.pageDisplay);
      const simplify = _userData.map((item, index) => {
        const handle = item.handle ? "[√]" : "[×]";
        const uindex = " " + (index + 1) + " ";
        const time = "(" + tool.dateFormat(item.time).day + ")";
        const content = item.msg.length > 10 ? item.msg.slice(0, 11) + "..." : item.msg;
        return handle + uindex + time + " " + tool.processLinks(content);
      }).join("\n");
      if (!allSortData.length) {
        return { code: true, msg: "[!] 当前还没有任何反馈内容..." };
      }
      return {
        code: true,
        msg: "你已进入管理员审核列表，以下是所有反馈内容：\n\n" + simplify + `

当前页数(${this.useridList[userId].page + 1}/${Math.ceil(this.useridList[userId].content.length / config.pageDisplay)})
回复 /反馈 查看 下标 查看详情`
      };
    },
    // 查看待办反馈历史 (忽略已处理)
    async adminGetFeedbackWaitList(userId, resume = false) {
      if (!config.adminQQ.includes(userId))
        return { code: false, msg: "您不是管理员，无法使用该指令" };
      const upath = path.join(ctx.localstorage.basePath, "./smmFeedback");
      if (!fs.existsSync(upath)) {
        fs.mkdirSync(upath, { recursive: true });
      }
      const userDir = fs.readdirSync(upath);
      let allUserList = [];
      const eventList = userDir.map((item) => {
        return new Promise(async (resolve, reject) => {
          try {
            const data = JSON.parse(await ctx.localstorage.getItem(`smmFeedback/${item}`) || "[]");
            allUserList.push(...data);
            resolve(true);
          } catch (error) {
            resolve(true);
          }
        });
      });
      await Promise.all(eventList);
      allUserList = allUserList.filter((item) => !item.handle);
      const allSortData = tool.sortFeedbackList(allUserList);
      if (resume) {
        this.useridList[userId].content = allSortData;
        this.useridList[userId].type = 2;
      } else {
        this.useridList[userId] = { page: 0, content: allSortData, type: 2 };
      }
      const radiusIndex = config.pageDisplay * this.useridList[userId].page;
      const _userData = allSortData.slice(radiusIndex, radiusIndex + config.pageDisplay);
      const simplify = _userData.map((item, index) => {
        const handle = item.handle ? "[√]" : "[×]";
        const uindex = " " + (index + 1) + " ";
        const time = "(" + tool.dateFormat(item.time).day + ")";
        const content = item.msg.length > 10 ? item.msg.slice(0, 11) + "..." : item.msg;
        return handle + uindex + time + " " + tool.processLinks(content);
      }).join("\n");
      if (!allSortData.length) {
        return { code: true, msg: "[!] 当前还没有任何待办内容..." };
      }
      return {
        code: true,
        msg: "[!] 你已进入管理员审核列表，以下是所有待办反馈：\n\n" + simplify + `

当前页数(${this.useridList[userId].page + 1}/${Math.ceil(this.useridList[userId].content.length / config.pageDisplay)})
回复 /反馈 查看 下标 查看详情`
      };
    },
    // 管理员对选中的反馈批改完成选项
    async adminSelectOverItem(userId) {
      if (!config.adminQQ.includes(userId))
        return { code: false, msg: "您不是管理员，无法使用该指令" };
      const selectId = this.useridList[userId].select;
      if (!selectId && selectId !== 0) {
        return { code: false, msg: "你还没有选择目标，请先 /反馈 查看 下标 后再执行该指令" };
      }
      const content = this.useridList[userId].content[selectId];
      content.handle = true;
      const goalUserId = content.userId;
      const data = JSON.parse(await ctx.localstorage.getItem(`smmFeedback/${goalUserId}`) || "[]");
      const changeData = data.find((item) => item.time == content.time);
      changeData.handle = true;
      await ctx.localstorage.setItem(`smmFeedback/${goalUserId}`, JSON.stringify(data));
      return { code: true, msg: "操作完成" };
    },
    // 管理员对选中的反馈进行留言
    async adminSelectMsgItem(userId, message) {
      if (!config.adminQQ.includes(userId))
        return { code: false, msg: "您不是管理员，无法使用该指令" };
      const selectId = this.useridList[userId].select;
      if (!selectId && selectId !== 0) {
        return { code: false, msg: "你还没有选择目标，请先 /反馈 查看 下标 后再执行该指令" };
      }
      const content = this.useridList[userId].content[selectId];
      content.backMsg.push({ name: "admin", msg: message });
      const goalUserId = content.userId;
      const data = JSON.parse(await ctx.localstorage.getItem(`smmFeedback/${goalUserId}`) || "[]");
      const changeData = data.find((item) => item.time == content.time);
      changeData.backMsg.push({ name: "admin", msg: message });
      await ctx.localstorage.setItem(`smmFeedback/${goalUserId}`, JSON.stringify(data));
      return { code: true, msg: "操作完成" };
    }
  };
  const tool = {
    // 下载图片至本地
    async downloadImage(imageUrl, upath = path.join(ctx.baseDir, config.downloadPath)) {
      if (!fs.existsSync(upath)) {
        fs.mkdirSync(upath, { recursive: true });
      }
      const timestamp = (new Date()).getTime();
      const imagePath = path.join(upath, `${timestamp}.jpg`);
      const response = await ctx.http.get(imageUrl, { responseType: "stream" });
      const writer = fs.createWriteStream(imagePath);
      const responseNodeStream = Readable.fromWeb(response);
      responseNodeStream.pipe(writer);
      return await new Promise((resolve, reject) => {
        writer.on("finish", () => {
          resolve(pathToFileURL(imagePath).href);
        });
        writer.on("error", reject);
      });
    },
    // 格式化时间
    dateFormat(time) {
      const date = new Date(time);
      let year = date.getFullYear();
      let month = date.getMonth() + 1;
      let day = date.getDate();
      let hours = date.getHours();
      let minutes = date.getMinutes();
      let formattedDate = year + "-" + (month < 10 ? "0" + month : month) + "-" + (day < 10 ? "0" + day : day);
      let formattedTime = (hours < 10 ? "0" + hours : hours) + ":" + (minutes < 10 ? "0" + minutes : minutes);
      return {
        day: formattedDate,
        time: formattedTime
      };
    },
    // 数组排序
    sortFeedbackList(feedbackList) {
      const overList = feedbackList.filter((item) => item.handle);
      const waitList = feedbackList.filter((item) => !item.handle && !item.up);
      const hotWaitList = feedbackList.filter((item) => !item.handle && item.up);
      waitList.sort((a, b) => b.time - a.time);
      hotWaitList.sort((a, b) => b.time - a.time);
      return [...hotWaitList, ...waitList, ...overList];
    },
    // 生成签名
    getSignature() {
      function generateHmacSha256(key2, data) {
        const hmac = crypto.createHmac("sha256", key2);
        hmac.update(data);
        const hash = hmac.digest("hex");
        return hash;
      }
      const apiId = config.Appid;
      const key = config.key;
      const time = Math.floor(+new Date() / 1e3);
      const queryKey = {
        "Api-Appid": apiId,
        "Api-Nonce-Str": "123456",
        "Api-Timestamp": time,
        "key": key
      };
      const ascllSortMap = Object.keys(queryKey).sort();
      const strKey = ascllSortMap.map((item) => {
        return `${item}=${queryKey[item]}`;
      }).join("&");
      console.log(strKey);
      const keyData = generateHmacSha256(key, strKey).toUpperCase();
      return {
        "Api-Appid": apiId,
        "Api-Nonce-Str": "123456",
        "Api-Timestamp": time,
        "Api-Sign": keyData
      };
    },
    processLinks(text: string): string {
      return text.replace(
        /https?:\/\/([^\s]+)/gi,
        (_, url) => url.toUpperCase()
      );
    }
  };
  ctx.on("ready", () => {
  });
  ctx.command("反馈.提交 <ask:text>", '向作者提交新的反馈内容').action(async ({ session }, ask) => {
    let at = "";
    if (config.atQQ) {
      at = `<at id="${session.userId}" />`;
    }
    if (!userTemp.userIdList[session.userId]) {
      userTemp.userIdList[session.userId] = 0;
    }
    const waitTime = +/* @__PURE__ */ new Date() - userTemp.userIdList[session.userId];
    if (waitTime < config.waitTime) {
      const needTime = config.waitTime - waitTime;
      await session.send(at + `你的提交太快，请等待${Math.ceil(needTime / 1e3)}秒`);
      return;
    }
    let msg = "";
    let imgList = [];
    if (!ask) {
      await session.send(at + '感谢您的反馈，请在60秒提交你需要反馈问题(回复"否"结束反馈对话)，可以插入图片。');
      msg = await session.prompt(3e4);
      if (msg == "否" || !msg)
        return;
      if (!h.select(msg, "img").length) {
        await session.send(at + '文本记录完毕，是否有需要提交的图片？(10秒后或者回复"否"即可结束反馈对话)');
        const addImgMsg = await session.prompt(1e4);
        if (msg == "否" || !msg)
          return;
        imgList.push(...h.select(addImgMsg, "img").map((item) => item.attrs.src));
      }
    } else {
      msg = ask;
    }
    imgList.push(...h.select(msg, "img").map((item) => item.attrs.src));
    const msgList = h.select(msg, "text").map((item) => item.attrs.content);
    imgList = imgList.slice(0, config.imgMaxLen);
    msg = msgList.join("").substring(0, config.textMaxLen);

    // 拦截内容
    if (config.refuseWord.length) {
      const isRefuse = config.refuseWord.some((str) => {
        return msg.includes(str)
      })
      if (isRefuse) {
        await session.send(at + `抱歉，您的内容有误无法提交。请整理后重新输入`);
        return
      }
    }

    // 过滤内容
    if (config.filterWord.length) {
      config.filterWord.forEach((str) => {
        const regxp = new RegExp(str, 'g')
        msg = msg.replace(regxp, '')
      })
      if (!msg.trim()) {
        await session.send(at + `您似乎并没有提交任何内容...`);
        return
      }
    }

    if (config.picDetection && config.Appid && config.key) {
      const dict = { err: 0 };
      const eventList = imgList.map((item, index) => {
        return new Promise(async (resolve, reject) => {
          try {
            const result2 = await ctx.http.post(`https://tools.mgtv100.com/external/v1/qcloud_content_audit`, {
              audit_type: "image",
              audit_content: item
            }, {
              headers: tool.getSignature()
            });
            if (result2.code == 200 && result2.data?.LabelResults) {
              const flag = result2.data.LabelResults.every((item2) => {
                if (config.filter.includes(item2.Scene) && item2.Suggestion !== "Pass") {
                  return false;
                } else {
                  return true;
                }
              });
              if (!flag) {
                dict.err++;
                imgList[index] = null;
              }
            } else {
              console.log("不良图像审核处理失败，检测 key 是否失效或者有效。或 key 的次数用完");
            }
            console.log(JSON.stringify(result2));
            resolve(true);
          } catch (error) {
            console.log(error);
            resolve(true);
          }
        });
      });
      await Promise.all(eventList);
      if (dict.err) {
        await session.send(at + `存在${dict.err}张不良图片，提交前已过滤`);
      }
      imgList = imgList.filter((item) => item !== null);
    }
    if (config.textDetaction && config.Appid && config.key) {
      try {
        const result2 = await ctx.http.post(`https://tools.mgtv100.com/external/v1/qcloud_content_audit`, {
          audit_type: "text",
          audit_content: msg
        }, {
          headers: tool.getSignature()
        });
        if (result2.code == 200 && result2.data?.DetailResults) {
          result2.data.DetailResults.forEach((item) => {
            if (config.textfilter.includes(item.Label) && item.Suggestion !== "Pass") {
              item.Keywords.forEach((text) => {
                msg = msg.replace(new RegExp(text, "g"), "***");
              });
            }
          });
        } else {
          console.log("不良文本审核处理失败，检测 key 是否失效或者有效。或 key 的次数用完");
        }
        console.log(JSON.stringify(result2));
      } catch (error) {
        console.log(error);
      }
    }
    const result = await feedback.setFeekback(session.userId, JSON.stringify(msg), imgList);
    if (!result.code) {
      await session.send(at + "发送失败...");
      return;
    }
    userTemp.userIdList[session.userId] = +/* @__PURE__ */ new Date();
    await session.send(at + "反馈成功，过段时间可以发送 /反馈 回执 查看管理员的回复~");
  });
  ctx.command("反馈.回执", '查看反馈的记录').action(async ({ session }) => {
    let at = "";
    if (config.atQQ) {
      at = `<at id="${session.userId}" />`;
    }
    const { msg } = await feedback.getMyFeedback(session.userId, session, at);
    await session.send(msg);
  });
  ctx.command("反馈.查看 <index:number>", '查看指定反馈内容').action(async ({ session }, index) => {
    let at = "";
    if (config.atQQ) {
      at = `<at id="${session.userId}" />`;
    }
    const { msg } = await feedback.getMyFeedbackDetail(session.userId, index);
    return at + msg;
  });
  ctx.command("反馈.下页", '查看下页的反馈内容').action(async ({ session }) => {
    let at = "";
    if (config.atQQ) {
      at = `<at id="${session.userId}" />`;
    }
    const { msg } = await feedback.getMyFeedbackDownPage(session.userId, session, at);
    await session.send(at + msg);
  });
  ctx.command("反馈.上页", '查看上页的反馈内容').action(async ({ session }) => {
    let at = "";
    if (config.atQQ) {
      at = `<at id="${session.userId}" />`;
    }
    const { msg } = await feedback.getMyFeedbackUpPage(session.userId, session, at);
    await session.send(at + msg);
  });
  ctx.command("反馈.跳页 <page:number>", '跳转指定页数反馈列表').action(async ({ session }, page) => {
    let at = "";
    if (config.atQQ) {
      at = `<at id="${session.userId}" />`;
    }
    const { msg } = await feedback.getMyFeedbackJumpPage(session.userId, page, session, at);
    await session.send(at + msg);
  });
  ctx.command("反馈.待办", '查看未处理的反馈列表').action(async ({ session }) => {
    let at = "";
    if (config.atQQ) {
      at = `<at id="${session.userId}" />`;
    }
    const result = await feedback.adminGetFeedbackWaitList(session.userId);
    if (!result.code) {
      await session.send(at + result.msg);
      return;
    }
    await session.send(at + result.msg);
  });
  ctx.command("反馈.完成", '将未处理反馈设置为已处理').action(async ({ session }) => {
    let at = "";
    if (config.atQQ) {
      at = `<at id="${session.userId}" />`;
    }
    const result = await feedback.adminSelectOverItem(session.userId);
    if (!result.code) {
      await session.send(at + result.msg);
      return;
    }
    await session.send(at + result.msg);
  });
  ctx.command("反馈.留言 <msg:text>", '对反馈的内容留言记录').action(async ({ session }, msg) => {
    let at = "";
    if (config.atQQ) {
      at = `<at id="${session.userId}" />`;
    }
    const message = JSON.stringify(msg);
    const result = await feedback.adminSelectMsgItem(session.userId, message);
    if (!result.code) {
      await session.send(at + result.msg);
      return;
    }
    await session.send(at + result.msg);
  });
  const userTemp = {
    userIdList: {}
  };
}
