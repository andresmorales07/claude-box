export declare function createApp(): {
    server: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
    wss: import("ws").Server<typeof import("ws").default, typeof import("http").IncomingMessage>;
};
