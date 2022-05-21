const core = require("@actions/core");
const fs = require("fs/promises");
const axios = require("axios");
// const createNotificationMsg = require("../google-chat-notification-on-push");
// const closureCompiler = require("google-closure-compiler").compiler;
// closureCompiler.prototype.javaPath = '/usr/bin/java';
// console.log('closureCompiler:', closureCompiler);
// const { compiler } = closureCompiler;
// console.log('compiler:', compiler);
// const event = JSON.parse(core.getInput("event"));
// const steps = JSON.parse(core.getInput("steps"));
// console.log("event:", event);
// console.log("steps:", steps);

runCompilerChecks();

async function runCompilerChecks() {
  const outputMsg = await readPWAMP();
  if (outputMsg) {
    const chatMsg = makeChatMsg(outputMsg);
    await sendChatMsg(chatMsg);
  }
}

async function readPWAMP() {
  try {
    const pwamp = await fs.readFile("./src/pwamp.js", { encoding: "utf8" });

    const response = await axios.post(
      "https://wompclosure.azurewebsites.net/compile",
      pwamp
    );
    console.log("response.data:", response.data);

    if (!response.data.success) {
      return response.data.error;
    }
  } catch (error) {
    // const compiler = new closureCompiler({
    //   js: "*/**/pwamp.js",
    //   compilation_level: "SIMPLE",
    //   // language_in: "ECMASCRIPT_2018",
    //   language_out: "ECMASCRIPT_2018",
    //   js_output_file: "pwamp.compiled.js",
    // });

    // const compilerProcess = compiler.run((exitCode, stdOut, stdErr) => {
    //   //compilation complete
    //   // console.log("stdOut:", stdOut);
    //   // console.log('stdErr:', stdErr);
    //   // console.log('stdErr:', stdErr);
    //   core.setOutput("compilerOutput", stdErr);
    // });
    // const compilerProcess = compiler.run((exitCode, stdOut, stdErr) => {
    //   //compilation complete
    //   console.log("stdOut:", stdOut);
    // });

    // Quote literals will break things.
    // event.commits.forEach((commit) => {
    //   // console.log("commit:", commit);
    //   sanitize(commit);
    // });

    // function sanitize(obj) {
    //   Object.keys(obj).forEach((key) => {
    //     if (typeof obj[key] == "string") {
    //       obj[key] = obj[key].replace(/"|'/g, "");
    //     } else {
    //       sanitize(obj[key]);
    //     }
    //     return;
    //   });
    // }
    // const lastCommit = event.commits[event.commits.length - 1];

    // [...new Set] removes duplicate names
    // const commitAuthors = [
    //   ...new Set(event.commits.map((x) => x.committer.name)),
    // ];
    // // console.log('commitAuthors:', commitAuthors);
    // const fileChangeCount = JSON.parse(steps.files.outputs.all).length;

    // const chatMsg = `'{
    //   "cards": [
    //     {
    //       "header": {
    //         "title": "Commit on Main",
    //         "subtitle": "Pushed by XXX",
    //         "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Git_icon.svg/1024px-Git_icon.svg.png",
    //         "imageStyle": "IMAGE"
    //       },
    //       "sections": [
    //         {
    //           "widgets": [
    //             {
    //               "textParagraph": {
    //                 "text": "",
    //               }
    //             },
    //             {
    //               "buttons":[
    //                 {
    //                   "textButton": {
    //                     "text": "View diff on GitHub",
    //                     "onClick": {
    //                       "openLink": {
    //                         "url": ""
    //                       }
    //                     }
    //                   }
    //                 }
    //               ]
    //             },
    //             {
    //               "textParagraph": {
    //                 "text": "<b>Most Recent Commit:</b>",
    //               }
    //             },
    //             {
    //               "keyValue": {
    //               "topLabel": "Msg",
    //               "content": "",
    //               "contentMultiline": "true",
    //               }
    //             },
    //             {
    //               "keyValue": {
    //               "topLabel": "Timestamp",
    //               "content": "",
    //               "contentMultiline": "true",
    //               }
    //             },
    //             {
    //               "keyValue": {
    //               "topLabel": "Author",
    //               "content": "",
    //               "contentMultiline": "true",
    //               }
    //             },
    //             {
    //               "keyValue": {
    //               "topLabel": "Hash",
    //               "content": "",
    //               "contentMultiline": "true",
    //               }
    //             },
    //             {
    //               "buttons":[
    //                 {
    //                   "textButton": {
    //                     "text": "View commit on GitHub",
    //                     "onClick": {
    //                       "openLink": {
    //                         "url": ""
    //                       }
    //                     }
    //                   }
    //                 }
    //               ]
    //             }
    //           ],
    //         },
    //       ]
    //     },
    //   ]
    // }'`;

    // core.setOutput("chat-msg", chatMsg);
    core.setFailed(error.message);
  }
}

function makeChatMsg(outputMsg) {
  // console.log("typeof outputMsg:", typeof outputMsg);
  // const outputMsgNew = encodeURI(outputMsg);
  console.log("outputMsg:", outputMsg);
  // const event = JSON.parse(core.getInput("event"));
  // const steps = JSON.parse(core.getInput("steps"));

  // const chatMsg = `'{
  //   "cards": [
  //     {
  //       "header": {
  //         "title": "PWAMP Compile Error!",
  //         "subtitle": "Pushed by ${event.pusher.name}",
  //         "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Git_icon.svg/1024px-Git_icon.svg.png",
  //         "imageStyle": "IMAGE"
  //       },
  //       "sections": [
  //         {
  //           "widgets": [
  //             {
  //               "textParagraph": {
  //                 "text": "Includes:\n<b>${event.commits.length} commit${
  //   event.commits.length === 1 ? "" : "s"
  // }</b> by ${commitAuthors.join(", ")}\n<b>${fileChangeCount} file${
  //   fileChangeCount === 1 ? "" : "s"
  // }</b> changed",
  //               }
  //             },
  //             {
  //               "buttons":[
  //                 {
  //                   "textButton": {
  //                     "text": "View diff on GitHub",
  //                     "onClick": {
  //                       "openLink": {
  //                         "url": "${event.compare}"
  //                       }
  //                     }
  //                   }
  //                 }
  //               ]
  //             },
  //             {
  //               "textParagraph": {
  //                 "text": "<b>Most Recent Commit:</b>",
  //               }
  //             },
  //             {
  //               "keyValue": {
  //               "topLabel": "Msg",
  //               "content": "${lastCommit.message}",
  //               "contentMultiline": "true",
  //               }
  //             },
  //             {
  //               "keyValue": {
  //               "topLabel": "Timestamp",
  //               "content": "${new Date(lastCommit.timestamp).toLocaleString(
  //                 "en-US",
  //                 {
  //                   timeZone: "America/Los_Angeles",
  //                   dateStyle: "short",
  //                   timeStyle: "short",
  //                 }
  //               )}",
  //               "contentMultiline": "true",
  //               }
  //             },
  //             {
  //               "keyValue": {
  //               "topLabel": "Author",
  //               "content": "${lastCommit.committer.name}",
  //               "contentMultiline": "true",
  //               }
  //             },
  //             {
  //               "keyValue": {
  //               "topLabel": "Hash",
  //               "content": "${lastCommit.id}",
  //               "contentMultiline": "true",
  //               }
  //             },
  //             {
  //               "buttons":[
  //                 {
  //                   "textButton": {
  //                     "text": "View commit on GitHub",
  //                     "onClick": {
  //                       "openLink": {
  //                         "url": "${lastCommit.url}"
  //                       }
  //                     }
  //                   }
  //                 }
  //               ]
  //             }
  //           ],
  //         },
  //       ]
  //     },
  //   ]
  // }'`;
  const chatMsg = JSON.stringify({
    cards: [
      {
        header: {
          title: "PWAMP compiling failed!!",
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
                  text: `"${outputMsg}"`,
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
    // console.log('core.getInput("secrets"):', core.getInput("secrets"));
    const gchat_webhook =
      "https://chat.googleapis.com/v1/spaces/AAAA3NnlvUE/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=M8EZgYF-vyXvIsZCcK2H75Ruw93A5y6hNCisLvSY4rw%3D";
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
    // console.log("response:", response);
    debugger;
  } catch (err) {
    console.log(err);
  }
}