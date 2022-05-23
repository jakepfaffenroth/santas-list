const core = require("@actions/core");
const fs = require("fs/promises");
const axios = require("axios");
const github = JSON.parse(core.getInput("github"));
github.ref_name = github.ref_name || "main";

runCompilerChecks();

// ---------- //

async function runCompilerChecks() {
  try {
    const pwamp = await fs.readFile("./src/pwamp.js", { encoding: "utf8" });
    const outputMsg = await callCompilerApi(pwamp);
    if (outputMsg) {
      // Compile errors encountered
      const chatMsg = makeChatMsg(outputMsg);
      await sendChatMsg(chatMsg);
    }
  } catch (err) {
    core.setFailed(err);
  }
}

async function callCompilerApi(pwamp) {
  console.log("github:", github);
  try {
    const compilation_level = "SIMPLE";
    const language_in = "ECMASCRIPT_2019";
    const language_out = "ECMASCRIPT5";

    const response = await axios.get(
      `https://wompclosure.azurewebsites.net/compile?wm_url=${encodeURIComponent(
        `https://raw.githubusercontent.com/${github.repository}/${github.ref_name}/src/pwamp.js?token=${github.token}`
      )}&compilation_level=${compilation_level}&language_out=${language_out}&language_in=${language_in}`
    );
    console.log("response:", response);

    if (!response.data.success) {
      return response.data.error;
    }
  } catch (error) {
    console.log("error calling compiler api:", error);
    core.setFailed(error.message);
  }
}

function makeChatMsg(outputMsg) {
  const errs = outputMsg.match(/Input.*\n*.*/gm);
  const newMsgArr = [];
  errs.forEach((err) => {
    const line = (err.match(/(?<=:)[0-9]+/) || [""])[0];
    err = err
      .replaceAll("\n\n", "\n")
      .replaceAll(
        /(?<=:)[^0-9]\s?(?<feature>.*[^\.])/gm,
        '<br><b><font color="#C92A2A">$&</font></b>'
      );
    newMsgArr.push(
      (
        err +
        `
        PWAMP Line ${line}
        <a href="https://github.com/${github.repository}/blob/${github.ref_name}/src/pwamp.js#L${line}">View on GitHub</a>`
      ).trim()
    );
  });
  outputMsgNew = newMsgArr.join("\n\n");

  const chatMsg = JSON.stringify({
    cards: [
      {
        header: {
          title: "PWAMP compilation failed!",
        },
        sections: [
          {
            widgets: [
              {
                image: {
                  imageUrl:
                    "https://miro.medium.com/max/552/1*ON_d7DWgW8g8uu3EBntfNw.png",
                },
              },
              {
                textParagraph: {
                  text: `${outputMsgNew}`,
                },
              },
            ],
          },
        ],
      },
    ],
  });

  core.setOutput("chat-msg", chatMsg);
  return chatMsg;
}

async function sendChatMsg(chatMsg) {
  try {
    // const gchat_webhook = core.getInput("gchat_webhook");
    // console.log("gchat_webhook:", gchat_webhook);
    const response = await axios({
      method: "POST",
      url: "https://chat.googleapis.com/v1/spaces/AAAA3NnlvUE/messages",
      params: {
        key: "AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI",
        token: "M8EZgYF-vyXvIsZCcK2H75Ruw93A5y6hNCisLvSY4rw=",
      },
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
      data: chatMsg,
    });
    // console.log('response:', response);
    if (response.statusText != "OK") {
      throw new Error(`Err sending gchat msg - ${response.statusText}`);
    }
    // console.log("response:", response);
  } catch (err) {
    console.log("Err sending gchat msg\n", err);
  }
}

