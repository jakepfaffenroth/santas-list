const core = require("@actions/core");
const closureCompiler = require("google-closure-compiler").compiler;
// closureCompiler.prototype.javaPath = '/usr/bin/java';
// console.log('closureCompiler:', closureCompiler);
// const { compiler } = closureCompiler;
// console.log('compiler:', compiler);
try {
  // const event = JSON.parse(core.getInput("event"));
  // const steps = JSON.parse(core.getInput("steps"));
  // console.log("steps:", steps);

  const compiler = new closureCompiler({
    js: "*/**/pwamp.js",
    compilation_level: "SIMPLE",
    // language_in: "ECMASCRIPT_2018",
    language_out: "ECMASCRIPT_2018",
    js_output_file: "pwamp.compiled.js",
  });

  const compilerProcess = compiler.run((exitCode, stdOut, stdErr) => {
    //compilation complete
    // console.log("stdOut:", stdOut);
    // console.log('stdErr:', stdErr);
    // console.log('stdErr:', stdErr);
    core.setOutput("compilerOutput", stdErr);
  });
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

  const chatMsg = `'{
    "cards": [
      {
        "header": {
          "title": "Commit on Main",
          "subtitle": "Pushed by XXX",
          "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Git_icon.svg/1024px-Git_icon.svg.png",
          "imageStyle": "IMAGE"
        },
        "sections": [
          {
            "widgets": [
              {
                "textParagraph": {
                  "text": "",
                }
              },
              {
                "buttons":[
                  {
                    "textButton": {
                      "text": "View diff on GitHub",
                      "onClick": {
                        "openLink": {
                          "url": ""
                        }
                      }
                    }
                  }
                ]
              },
              {
                "textParagraph": {
                  "text": "<b>Most Recent Commit:</b>",
                }
              },
              {
                "keyValue": {
                "topLabel": "Msg",
                "content": "",
                "contentMultiline": "true",
                }
              },
              {
                "keyValue": {
                "topLabel": "Timestamp",
                "content": "",
                "contentMultiline": "true",
                }
              },
              {
                "keyValue": {
                "topLabel": "Author",
                "content": "",
                "contentMultiline": "true",
                }
              },
              {
                "keyValue": {
                "topLabel": "Hash",
                "content": "",
                "contentMultiline": "true",
                }
              },
              {
                "buttons":[
                  {
                    "textButton": {
                      "text": "View commit on GitHub",
                      "onClick": {
                        "openLink": {
                          "url": ""
                        }
                      }
                    }
                  }
                ]
              }
            ],
          },
        ]
      },
    ]
  }'`;

  // core.setOutput("chat-msg", chatMsg);
} catch (error) {
  core.setFailed(error.message);
}
