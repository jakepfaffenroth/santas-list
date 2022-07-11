#! /usr/bin/bash



outputMsg=$(google-closure-compiler --js ./src/pwamp.js --compilation_level SIMPLE --language_out ECMASCRIPT5 --warning_level QUIET 2>&1); echo "::set-output name=compilerOutput::'$outputMsg'";
