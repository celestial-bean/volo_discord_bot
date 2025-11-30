import { CommandLine } from '../utils/commandline';

export class CLIArgs extends CommandLine {
  static verbose: boolean = false;
  static transcriber_type: string = "local";
}

