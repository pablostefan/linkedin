import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUTPUT_PATH = path.resolve(".local/linkedin/zernio-posts.json");
const PAGE_SIZE = 100;

function fetchPage(page) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      "npx",
      ["zernio", "posts:list", "--status", "published", "--limit", String(PAGE_SIZE), "--page", String(page)],
      { shell: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr?.trim() || error.message;
          const wrapped = new Error(`Zernio CLI failed: ${message}`);
          wrapped.code = "zernio_cli_error";
          reject(wrapped);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Failed to parse Zernio response: ${stdout.trim()}`));
        }
      }
    );
  });
}

async function syncPosts() {
  console.log("Fetching published posts from Zernio...");

  const firstPage = await fetchPage(1);
  const { posts: firstPosts = [], pagination = {} } = firstPage;
  const totalPages = pagination.pages ?? 1;
  const totalPosts = pagination.total ?? firstPosts.length;

  console.log(`Total: ${totalPosts} posts across ${totalPages} page(s)`);

  let allPosts = [...firstPosts];

  for (let page = 2; page <= totalPages; page++) {
    console.log(`  Fetching page ${page}/${totalPages}...`);
    const result = await fetchPage(page);
    allPosts = allPosts.concat(result.posts ?? []);
  }

  const output = {
    synced_at: new Date().toISOString(),
    total: allPosts.length,
    posts: allPosts,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");

  console.log(`Done. ${allPosts.length} posts saved to ${OUTPUT_PATH}`);
}

syncPosts().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
