import {defineConfig,devices} from "@playwright/test";
export default defineConfig({testDir:"./e2e",webServer:{command:"npm run dev -- --port 3210",url:"http://localhost:3210",reuseExistingServer:false},use:{baseURL:"http://localhost:3210",trace:"on-first-retry"},projects:[{name:"iPhone",use:{...devices["iPhone 14"]}},{name:"desktop",use:{...devices["Desktop Chrome"]}}]});
