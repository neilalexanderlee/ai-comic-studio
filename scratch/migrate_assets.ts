import { db, runMigrations } from "../src/lib/db";
import { characters, characterAssets } from "../src/lib/db/schema";
import { ulid } from "ulid";

async function migrate() {
  console.log("Starting asset migration...");
  const allChars = await db.select().from(characters);
  console.log(`Found ${allChars.length} characters.`);
  
  for (const char of allChars) {
    // 1. Beauty Image -> 日常
    if (char.beautyImage) {
      console.log(`Migrating beauty image for ${char.name}`);
      await db.insert(characterAssets).values({
        id: ulid(),
        characterId: char.id,
        imagePath: char.beautyImage,
        tag: "日常",
        isDefault: 1,
        assetType: "morph"
      });
    }
    
    // 2. Combat Image -> 武装
    if (char.combatImage) {
      console.log(`Migrating combat image for ${char.name}`);
      await db.insert(characterAssets).values({
        id: ulid(),
        characterId: char.id,
        imagePath: char.combatImage,
        tag: "武装",
        isDefault: 0,
        assetType: "morph"
      });
    }
    
    // 3. Reference Image -> 四视图
    if (char.referenceImage) {
      console.log(`Migrating reference image for ${char.name}`);
      await db.insert(characterAssets).values({
        id: ulid(),
        characterId: char.id,
        imagePath: char.referenceImage,
        tag: "四视图",
        isDefault: 0,
        assetType: "blueprint"
      });
    }
  }
  
  console.log("Migration completed.");
}

migrate().catch(console.error);
