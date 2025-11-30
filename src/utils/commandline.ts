export class CommandLine {
  static _optionalInt(string: string): number | null {
    return string === "None" ? null : parseInt(string, 10);
  }

  static _str2bool(string: string): boolean {
    const str2val: { [key: string]: boolean } = { "true": true, "false": false };
    if (string && string.toLowerCase() in str2val) {
      return str2val[string.toLowerCase()];
    } else {
      throw new Error(
        `Expected one of ${Object.keys(str2val).join(", ")}, got ${string}`
      );
    }
  }

  static _optionalFloat(string: string): number | null {
    return string === "None" ? null : parseFloat(string);
  }

  static updateFromArgs(args: any): void {
    for (const [key, value] of Object.entries(args)) {
      if (key in CommandLine) {
        (CommandLine as any)[key] = value;
      }
    }
  }

  static readCommandLine(): any {
    const args: any = {};
    
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

