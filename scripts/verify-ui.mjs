/* Optional real-browser checks. Uses Playwright from WP_UI_PLAYWRIGHT or local dev dependencies. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startTestServer, createClient, createUserSession, ADMIN, makeWordPressZip, makeThemeZip } from "../apps/server/tests/harness.mjs";
import { createZip } from "../packages/builder-core/dist/index.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WP_UI_PLAYWRIGHT || "playwright");
const temp = await mkdtemp(path.join(os.tmpdir(), "wp-ui-qa-"));
const screenshots = path.resolve("artifacts/ui-review");
await mkdir(screenshots, { recursive: true });
const previousHome = process.env.WP_STARTER_HOME;
process.env.WP_STARTER_HOME = path.join(temp, "local-library");
const { startGuiServer } = await import("../apps/gui/index.mjs");
let browser, local, hosted;
const errors = [];
let screenshotsTaken = 0;
function track(page) {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /Content Security Policy|Refused to/i.test(message.text())) errors.push(message.text()); });
  page.on("request",request=>{const url=new URL(request.url());if(["http:","https:"].includes(url.protocol)&&url.hostname!=="127.0.0.1"&&url.hostname!=="localhost")errors.push(`Unexpected external request: ${url.origin}`);});
}
async function navigation(page, view) {
  if (page.viewportSize().width < 768) await page.getByRole("button", { name:"Toggle navigation" }).click();
  await page.locator(`.nav[data-view="${view}"]`).click();
  await page.locator(`#view-${view}`).waitFor({state:"visible"});
}
async function snapshot(page, name) {
  await page.evaluate(() => scrollTo(0,0));
  await page.screenshot({ path:path.join(screenshots, `${name}.png`), fullPage:true });
  screenshotsTaken++;
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow: ${name}`);
}
try {
  local = await startGuiServer({ port:0, openBrowser:false, log:false });
  browser = await chromium.launch({ channel:process.env.WP_UI_BROWSER || "chrome", headless:true });
  const page = await browser.newPage({ viewport:{width:1440,height:960} });
  track(page);
  await page.goto(local.url);
  await page.waitForFunction(() => typeof state !== "undefined" && state !== null && !!window.WPWorkspace);
  for (const theme of ["light","dark"]) {
    await page.evaluate(theme => WPUI.setTheme(theme), theme);
    for (const width of [375,768,1024,1440]) {
      await page.setViewportSize({width,height:960});
      for (const view of ["overview","profiles","build","builds","packages","configs","elementor-templates","sample-content","design-systems","fonts","typography","colors"]) {
        await navigation(page, view);
        await snapshot(page, `empty-${theme}-${width}-${view}`);
      }
    }
  }
  await page.setViewportSize({width:1440,height:960});
  await page.evaluate(() => WPUI.setTheme("light"));
  const wp = await makeWordPressZip(temp);
  const theme = await makeThemeZip(temp, {slug:"starter",name:"Starter Theme",version:"1.0.0"});
  await navigation(page,"packages");
  await page.locator("#package-file").setInputFiles([wp,theme]);
  await page.waitForFunction(() => state.packages.length === 2);
  await page.locator("#view-packages .library-tools input").fill("no-such-package");
  assert.equal(await page.locator("#packages-body tr:visible").count(),0);
  await page.locator("#view-packages .library-tools input").fill("starter");
  assert.equal(await page.locator("#packages-body tr:visible").count(),1);
  await navigation(page,"profiles");
  await page.locator("#new-profile").click();
  await page.locator("#build-name").fill("QA Starter");
  await page.locator("#profile-tab-1").click();
  const themeValue = await page.locator("#build-theme option").last().getAttribute("value");
  await page.locator("#build-theme").selectOption(themeValue);
  const wpSelection = await page.locator("#build-wordpress").inputValue();
  await page.locator("#refresh").click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator("#build-wordpress").inputValue(),wpSelection);
  await page.locator("#profile-tab-0").click();
  assert.equal(await page.locator("#build-name").inputValue(),"QA Starter");
  await page.locator('.nav[data-view="packages"]').click();
  await page.getByRole("button",{name:"Keep editing",exact:true}).click();
  assert.equal(await page.locator("#view-profiles").isVisible(),true);
  assert.equal(await page.locator("#build-name").inputValue(),"QA Starter");
  await page.locator("#profile-tab-4").click();
  await snapshot(page,"profile-review");
  await page.locator("#create-profile").click();
  await page.waitForFunction(() => state.profiles.length === 1);
  await navigation(page,"build");
  assert.match(await page.locator("#build-summary").textContent(),/QA Starter/);
  let poll = 0;
  await page.route("**/api/build-jobs",route => route.fulfill({json:{id:"qa-build"}}));
  await page.route("**/api/build-jobs/qa-build",route => route.fulfill({json:++poll < 4 ? {status:"running",percent:35,message:"Copying packages",stage:"packages"} : {status:"complete",percent:100,message:"Build complete",result:{file:"qa.zip",sha256:"synthetic",download:"/download/qa.zip"}}}));
  await page.locator("#build-button").click();
  await page.waitForFunction(() => document.querySelector("#build-progress-percent").textContent === "35%");
  await navigation(page,"packages");
  assert.equal(await page.locator(".global-build").isVisible(),true);
  await page.waitForFunction(() => document.querySelector("#build-progress-percent").textContent === "100%");
  await navigation(page,"build");
  assert.match(await page.locator("#build-result").textContent(),/Build complete/);
  await navigation(page,"typography");
  await page.getByRole("button",{name:"New typography profile",exact:true}).click();
  await page.locator("#type-name").fill("QA Type");
  const size = page.locator('#type-rows [data-role="body"][data-dimension="size"]');
  await size.fill("19");
  await page.locator('[data-device="tablet"]').click();
  await page.locator('[data-device="desktop"]').click();
  assert.equal(await size.inputValue(),"19");
  await page.getByRole("tab",{name:"Global Fonts",exact:true}).click();
  await snapshot(page,"typography-global-fonts");
  assert.equal(await page.locator("#global-font-rows").isVisible(),true);
  await page.getByRole("tab",{name:"Theme Style",exact:true}).click();
  assert.equal(await size.inputValue(),"19");
  await page.locator("#type-rows .typography-details").first().locator("summary").click();
  await snapshot(page,"typography-expanded-settings");
  await page.locator("#type-save").click();
  await page.waitForFunction(() => state.vnext.typography.length === 1);
  await navigation(page,"colors");
  await page.getByRole("button",{name:"New color profile",exact:true}).click();
  await page.locator("#color-name").fill("QA Colors");
  await page.locator("#color-save").click();
  await page.waitForFunction(() => state.vnext.colors.length === 1);
  await navigation(page,"sample-content");
  await page.locator("#sample-new-post").click();
  await page.locator('[data-field="title"]').fill("QA Post");
  await page.locator('[data-action="save"]').click();
  await page.waitForFunction(() => state.sampleContent.content.length === 1);
  await navigation(page,"fonts");
  const fontRoot=path.join(temp,"fonts","QA Sans");await mkdir(fontRoot,{recursive:true});
  await writeFile(path.join(fontRoot,"QASans-Regular.woff2"),"synthetic-400");await writeFile(path.join(fontRoot,"QASans-Bold.woff2"),"synthetic-700");
  const fontZip=path.join(temp,"fonts.zip");await createZip(path.join(temp,"fonts"),fontZip);
  await page.locator("#font-file").setInputFiles(fontZip);await page.waitForFunction(()=>state.fonts.length===1);
  await navigation(page,"design-systems");
  await page.getByRole("button",{name:"New design system",exact:true}).click();await page.locator("#ds-name").fill("QA System");
  await page.locator("#ds-typography").selectOption(await page.locator("#ds-typography option").last().getAttribute("value"));
  await page.locator("#ds-colors").selectOption(await page.locator("#ds-colors option").last().getAttribute("value"));
  for(const select of await page.locator("#ds-binding-list select").all())await select.selectOption(await select.locator("option").last().getAttribute("value"));
  await page.locator("#ds-save").click();await page.waitForFunction(()=>state.vnext.designSystems.length===1);
  const exportRoot=path.join(temp,"snapshot");await mkdir(exportRoot,{recursive:true});
  await writeFile(path.join(exportRoot,"starter-config.json"),JSON.stringify({schema_version:2,exporter_version:"test",generated_at:"2026-09-14T05:01:24+00:00",source:{wordpress_version:"7.1",php_version:"8.3",locale:"en_US",site_domain:"qa.example.test",theme:{slug:"starter",name:"Starter Theme",version:"1.0.0"},plugins:[]},targets:{plugins:[]},wordpress:{options:{},pages:[]},adapters:{elementor:{options:{},kit_settings:{},templates:[{id:"qa-header",name:"QA Header",type:"header",document:[{widget:"heading"}]}]}},safety:{}}));
  await writeFile(path.join(exportRoot,"export-manifest.json"),"{}\n");
  const configZip=path.join(temp,"snapshot.zip");await createZip(exportRoot,configZip);
  await navigation(page,"configs");await page.locator("#config-file").setInputFiles(configZip);await page.waitForFunction(()=>state.configs.length===1&&state.elementorTemplates.length===1);
  await page.locator(".inspect-config").click();await page.locator("#config-inspector .inspect-tab").first().waitFor();await snapshot(page,"snapshot-inspector");await page.locator("#close-inspector").click();
  // Empty required fields retain values and provide linked error summaries.
  await navigation(page,"profiles");await page.locator("#new-profile").click();await page.locator("#build-name").fill("");await page.locator("#create-profile").click();
  assert.equal(await page.locator("#profile-editor .error-summary").isVisible(),true);
  await page.locator("#profile-editor .error-summary a").first().click();assert.equal(await page.locator("#build-name").isVisible(),true);
  await page.locator("#cancel-profile-edit").click();await page.getByRole("button",{name:"Discard",exact:true}).click();
  // Contrast measurements use the composed tokens rather than assuming dark parity.
  for(const mode of ["light","dark"]){
    await page.evaluate(mode=>WPUI.setTheme(mode),mode);
    const ratios=await page.evaluate(()=>{
      const styles=getComputedStyle(document.documentElement);
      function luminance(hex){const values=hex.trim().match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;}
      function ratio(a,b){const x=luminance(styles.getPropertyValue(a)),y=luminance(styles.getPropertyValue(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
      return {text:ratio("--text","--surface"),muted:ratio("--muted","--surface"),primary:ratio("--on-primary","--primary"),border:ratio("--border","--surface")};
    });
    assert.ok(ratios.text>=4.5&&ratios.muted>=4.5&&ratios.primary>=4.5,JSON.stringify({mode,ratios}));
    assert.ok(ratios.border>=3,JSON.stringify({mode,ratios}));
  }
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.evaluate(async()=>{for(const view of ["packages","fonts","profiles","build"]){await goView(view);}});
  assert.equal(await page.locator(".view.active").getAttribute("id"),"view-build");
  assert.equal(await page.locator(".view.active").evaluate(el=>el.getAnimations().length),0);
  for(const mode of ["light","dark"]){
    await page.evaluate(mode=>WPUI.setTheme(mode),mode);
    for(const width of [375,768,1024,1440]){
      await page.setViewportSize({width,height:960});
      for(const view of ["overview","profiles","build","builds","packages","configs","elementor-templates","sample-content","design-systems","fonts","typography","colors"]){await navigation(page,view);await snapshot(page,`populated-${mode}-${width}-${view}`);}
    }
    await page.setViewportSize({width:1060,height:700});
    for(const view of ["overview","profiles","build","builds","packages","configs","elementor-templates","sample-content","design-systems","fonts","typography","colors"]){await navigation(page,view);await snapshot(page,`desktop-minimum-${mode}-${view}`);}
  }
  hosted=await startTestServer();
  console.log("Local browser checks passed; checking hosted account and ownership screens.");
  const hostPage=await browser.newPage({viewport:{width:1440,height:960}});track(hostPage);
  await hostPage.goto(hosted.url+"/login");
  await hostPage.locator("#email").fill(ADMIN.email);await hostPage.locator("#password").fill(ADMIN.password);
  await hostPage.locator("#submit").click();await hostPage.waitForURL(hosted.url+"/");
  await hostPage.waitForSelector("#ws-account");
  const admin=createClient(hosted.url);await admin.signIn(ADMIN.email,ADMIN.password);
  const {client:other}=await createUserSession(admin,hosted.url,{email:"other@example.test",password:"other-password-123",role:"member"});
  const shared=await other.post("/api/vnext/colors",{json:{schemaVersion:1,id:"shared-colors",name:"Shared Colors",elementor:{primary:"#2458d3",secondary:"#334155",text:"#182338",accent:"#2458d3"},custom:[]}});
  assert.equal(shared.status,200);
  await hostPage.locator("#refresh").click();await navigation(hostPage,"colors");
  await hostPage.locator('.edit-resource[data-id="shared-colors"]').waitFor();
  await hostPage.waitForFunction(()=>document.querySelector('.edit-resource[data-id="shared-colors"]').disabled);
  assert.equal(await hostPage.locator('.duplicate-resource[data-id="shared-colors"]').isEnabled(),true);
  const deniedDelete=await admin.delete("/api/vnext/colors/shared-colors");assert.equal(deniedDelete.status,403);assert.equal(deniedDelete.json.error.code,"read_only");
  assert.equal(await admin.post("/api/vnext/colors",{csrf:false,json:{}}).then(res=>res.status),403);
  for(const mode of ["light","dark"]){
    await hostPage.evaluate(mode=>WPUI.setTheme(mode),mode);
    await snapshot(hostPage,`hosted-${mode}-read-only`);
    await hostPage.goto(hosted.url+"/admin");await hostPage.waitForSelector("#users table");
    for(const width of [375,768,1024,1440]){await hostPage.setViewportSize({width,height:960});await snapshot(hostPage,`hosted-${mode}-${width}-admin`);}
    await hostPage.goto(hosted.url+"/");await hostPage.waitForSelector("#ws-account");
  }
  const authPage=await browser.newPage();track(authPage);
  await authPage.goto(hosted.url+"/login");
  for(const mode of ["light","dark"]){await authPage.evaluate(mode=>WPUI.setTheme(mode),mode);for(const width of [375,768,1024,1440]){await authPage.setViewportSize({width,height:960});await snapshot(authPage,`hosted-${mode}-${width}-login`);await authPage.locator("#toggle").click();await snapshot(authPage,`hosted-${mode}-${width}-register`);await authPage.locator("#toggle").click();}}
  await authPage.reload();assert.equal(await authPage.locator("html").getAttribute("data-theme"),"dark");
  assert.deepEqual(errors,[]);
  console.log(`UI checks passed; ${screenshotsTaken} screenshots saved to ${screenshots}.`);
} finally {
  await browser?.close();
  await hosted?.stop();
  if(local)await new Promise(resolve=>local.server.close(resolve));
  if(previousHome===undefined)delete process.env.WP_STARTER_HOME;else process.env.WP_STARTER_HOME=previousHome;
  await rm(temp,{recursive:true,force:true});
}
