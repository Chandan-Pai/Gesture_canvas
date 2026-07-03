#!/usr/bin/env node
/**
 * Sync DEVLOG.md → Notion page (full overwrite).
 *
 * Setup:
 *   1. cp .env.example .env
 *   2. Fill NOTION_TOKEN + NOTION_PAGE_ID (see .env.example)
 *   3. npm install
 *   4. npm run sync:devlog
 *
 * Schedule nightly: bash scripts/install-launchagent.sh
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@notionhq/client';
import { markdownToBlocks } from '@tryfabric/martian';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DEVLOG_PATH = join(ROOT, 'DEVLOG.md');
const dryRun = process.argv.includes('--dry-run');

async function loadEnvFile() {
  try {
    const content = await readFile(join(ROOT, '.env'), 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* .env optional if vars exported in shell */
  }
}

function normalizePageId(raw) {
  let id = raw.trim().replace(/^["']|["']$/g, '');

  // Accept full Notion URLs — extract the 32-char page ID from the link
  if (id.includes('http') || id.length > 36) {
    const uuid = id.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    const hex32 = id.match(/([0-9a-f]{32})(?:[?#]|$)/i) || id.match(/([0-9a-f]{32})/i);
    if (uuid) id = uuid[1];
    else if (hex32) id = hex32[1];
  }

  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(
      'NOTION_PAGE_ID must be a 32-character Notion page ID (or paste the full Share link).',
    );
  }
  return id;
}

async function clearPage(notion, pageId) {
  let cursor;
  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of response.results) {
      await notion.blocks.delete({ block_id: block.id });
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
}

async function appendBlocks(notion, pageId, blocks) {
  const CHUNK = 100;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + CHUNK),
    });
  }
}

function syncMetaBlock() {
  const stamp = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [
        {
          type: 'text',
          text: {
            content: `Synced from DEVLOG.md on ${stamp} (Gesture Canvas local sync)`,
          },
        },
      ],
      icon: { type: 'emoji', emoji: '🔄' },
    },
  };
}

async function main() {
  await loadEnvFile();

  const token = process.env.NOTION_TOKEN;
  const pageId = process.env.NOTION_PAGE_ID
    ? normalizePageId(process.env.NOTION_PAGE_ID)
    : null;

  if (!token || !pageId) {
    console.error('Missing NOTION_TOKEN or NOTION_PAGE_ID.');
    console.error('Copy .env.example → .env and fill in both values.');
    process.exit(1);
  }

  let markdown;
  try {
    markdown = await readFile(DEVLOG_PATH, 'utf8');
  } catch {
    console.error(`Could not read ${DEVLOG_PATH}`);
    process.exit(1);
  }

  if (!markdown.trim()) {
    console.error('DEVLOG.md is empty — nothing to sync.');
    process.exit(1);
  }

  let blocks;
  try {
    blocks = markdownToBlocks(markdown);
  } catch (err) {
    console.error('Markdown → Notion conversion failed:', err.message);
    process.exit(1);
  }

  if (dryRun) {
    console.log('[dry-run] DEVLOG.md read OK');
    console.log(`[dry-run] Would upload ${blocks.length + 1} blocks to page ${pageId}`);
    console.log('[dry-run] No changes written to Notion.');
    return;
  }

  const notion = new Client({ auth: token });

  try {
    await notion.pages.retrieve({ page_id: pageId });
  } catch (err) {
    if (err.code === 'object_not_found') {
      console.error('Notion page not found. Check NOTION_PAGE_ID and grant the integration access:');
      console.error('  Notion page → ⋯ → Connections → add your integration');
    } else if (err.code === 'unauthorized') {
      console.error('Notion token invalid. Check NOTION_TOKEN in .env');
    } else {
      console.error('Notion API error:', err.message);
    }
    process.exit(1);
  }

  console.log(`Clearing Notion page ${pageId}…`);
  await clearPage(notion, pageId);

  const payload = [syncMetaBlock(), ...blocks];
  console.log(`Uploading ${payload.length} blocks…`);
  await appendBlocks(notion, pageId, payload);

  console.log('DEVLOG.md synced to Notion.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
