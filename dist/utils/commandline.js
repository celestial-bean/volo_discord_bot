"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandLine = void 0;
class CommandLine {
    static _optionalInt(string) {
        return string === "None" ? null : parseInt(string, 10);
    }
    static _str2bool(string) {
        const str2val = { "true": true, "false": false };
        if (string && string.toLowerCase() in str2val) {
            return str2val[string.toLowerCase()];
        }
        else {
            throw new Error(`Expected one of ${Object.keys(str2val).join(", ")}, got ${string}`);
        }
    }
    static _optionalFloat(string) {
        return string === "None" ? null : parseFloat(string);
    }
    static updateFromArgs(args) {
        for (const [key, value] of Object.entries(args)) {
            if (key in CommandLine) {
                CommandLine[key] = value;
            }
        }
    }
    static readCommandLine() {
        const args = {};
        // Parse command line arguments
        const processArgs = process.argv.slice(2);
        for (let i = 0; i < processArgs.length; i++) {
            if (processArgs[i] === "--verbose") {
                args.verbose = processArgs[i + 1] === "true";
                i++;
            }
        }
        return args;
    }
}
exports.CommandLine = CommandLine;
//# sourceMappingURL=commandline.js.map