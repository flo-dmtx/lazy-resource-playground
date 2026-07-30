import { Type } from "@angular/core";

import { ChainDemo } from "./demo-chain";
import { ContractDemo } from "./demo-contract";
import { LiftedDemo } from "./demo-lifted";
import { SleepingParamsDemo } from "./demo-sleeping-params";
import { TabsDemo } from "./demo-tabs";

/** StackBlitz URL of this project; empty hides the editor links. */
export const STACKBLITZ_PROJECT = "https://stackblitz.com/github/flo-dmtx/lazy-resource-playground";

export interface DemoEntry {
    readonly component: Type<unknown>;
    readonly file: string;
    readonly title: string;
}

export const DEMOS: Record<string, DemoEntry> = {
    lifted: {
        component: LiftedDemo,
        file: "demo-lifted.ts",
        title: "the fetch, lifted out of the child",
    },
    tabs: {
        component: TabsDemo,
        file: "demo-tabs.ts",
        title: "tabs, each with their own data",
    },
    params: {
        component: SleepingParamsDemo,
        file: "demo-sleeping-params.ts",
        title: "params picked before opening",
    },
    chain: {
        component: ChainDemo,
        file: "demo-chain.ts",
        title: "one resource depending on another",
    },
    contract: {
        component: ContractDemo,
        file: "demo-contract.ts",
        title: "writes and errors, before and after the first read",
    },
};

export function editorUrl(entry: DemoEntry, name: string): string {
    const path = encodeURIComponent(`/?demo=${name}`);
    return `${STACKBLITZ_PROJECT}?file=src/app/${entry.file}&initialpath=${path}`;
}
