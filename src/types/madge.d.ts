declare module "madge" {
  interface MadgeInstance {
    orphans(): string[];
    circular(): string[][];
  }

  interface MadgeOptions {
    fileExtensions?: string[];
    excludeRegExp?: RegExp[];
    tsConfig?: string;
  }

  function madge(path: string, options?: MadgeOptions): Promise<MadgeInstance>;
  export default madge;
}
