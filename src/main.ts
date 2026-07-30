import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";

import { App } from "./app/app";
import { DemoPage } from "./app/demo-page";

// `/?demo=<name>` serves a demo alone — the page the figures embed and link to.
const isDemoPage = new URLSearchParams(location.search).has("demo");

bootstrapApplication(isDemoPage ? DemoPage : App, {
    providers: [provideZonelessChangeDetection()],
});
