type Module = {
    id: string;
    url: URL;
    dependencies: string[];
    ready: Promise<void>;
}
