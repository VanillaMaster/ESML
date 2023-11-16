export interface Module {
    uuid: string;
    url: URL;
    dependencies: string[];
    ready: Promise<void>;
}
