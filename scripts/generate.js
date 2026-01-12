/*
This script is intended to read _lightly modified_* .json files in /static/recipe and then modify existing 
.mdx pages with the information from those .json files. The script is intended to be idempotent so don't
worry about running it too much UNLESS you've made changes to the resulting files afterwards.

* Bulk renames need to take place before running this:
    techreborn:blast_furnace -> techreborn:industrial_blast_furnace
    techreborn:centrifuge -> techreborn:industrial_centrifuge
    removed extractor/cell.json
    removed a large chunk of duplicate methan and methane producing recipes
*/
import fs from "fs/promises";
import path from "path";

(async() => {
	const recipesDir = path.join(process.cwd(), "static", "recipe");
	const outputFile = path.join(process.cwd(), "static", "processed_recipes.json");

	async function readRecipes(dir) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		const tree = {};

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				const subtree = await readRecipes(fullPath);

				if (Object.keys(subtree).length) {
					tree[entry.name] = subtree;
				}
			} else if (entry.isFile() && path.extname(entry.name) === ".json") {
				const raw = await fs.readFile(fullPath, "utf8");
				let json;

				try {
					json = JSON.parse(raw);
				} catch (err) {
					console.error(`⚠️  Skipping ${fullPath}: invalid JSON`);
					continue;
				}

				const key = path.basename(entry.name, ".json");
				json.id = entry.name.split(".").shift();
				tree[key] = json;
			}
		}

		return tree;
	}

	function flattenRecipes(recipes) {
		return Object.values(recipes).flatMap(item => {
			if ('outputs' in item || 'result' in item || 'fluid' in item) {
				return [item];
			}
			if (Array.isArray(item)) {
				return item;
			}
			return flattenRecipes(item);
		});
	}

	const recipes = await readRecipes(recipesDir);

	// now that we've read in all recipes, let's process them by category (folder)
	const HEADER = "### Crafting Recipes";
	for (const category of ORDER) {
		// and now by file (a single .json hopefully)
		const mdxPath = path.join(process.cwd(), category.path);
		let original = await fs.readFile(mdxPath, "utf8");
		original = original.split(HEADER).shift() + HEADER;
		let newSections = {};
		// todo: some are not flattened at this level, we need to fix that probably
		for (const item of Object.values(recipes[category.name])) {
			if (item.hasOwnProperty("type") === false) {
				// this is a sub folder, not an item
				throw new Error("Unhandled subfolder found, get good.");
			}
			// this converted information should be good regardless of destination
			// machine page, item page, etc.
			console.log(`* getting the item content for recipes[${category.name}][${item.id}]`);
			// itemContent is the json object of the item directly from the file
			const itemContent = recipes[category.name][item.id];
			// converted will be an object with mdx:markdown and obj:config(recipe) object
			const converted = formatter[category.func](itemContent);
			// idSection will be our best guess as programatically splitting crafting outputs into groups
			// i suspect this will result in some sorta odd groupings, but it's better than the alternative.
			// basically taking whatever comes before "_from" "blue_wool" for instance, and calling that a group OR using the first output item
			let idSection = (itemContent.id.includes("_from") === true) ? itemContent.id.split("_from").shift() : itemContent.id;
			// most types of groupings are the _from variety, some are just 2 after the name
			// i haven't seen any 3's yet...
			if (idSection.includes("_2") === true && category.overrides?.includes("no_digit_group") !== true) {
				idSection = idSection.slice(0, -2);
			}
			if (!newSections[idSection]) {
				newSections[idSection] = [];
			}
			newSections[idSection].push({
				config: converted.config,
				mdx: converted.mdx
			});
		}
		let renderedNewSection = "";
		for (const key in newSections) {
			if (newSections[key].length === 1) {
				// no collapsable
				renderedNewSection += newSections[key][0].mdx + "\n";
			} else {
				renderedNewSection += `<details>
				<summary><McItem slug="${getPackFromId(key, newSections[key][0].config)}" /></summary>
				${newSections[key].map(obj => obj.mdx).join("\n")}
				</details>\n`;
			}
		}
		const output = `${original}
		<details>
			<summary>Recipes using ${titleCase(category.name)}</summary>
			${renderedNewSection}
		</details>`
		await fs.writeFile(mdxPath, output, "utf8");
	}

  // Next, write the recipe(s) of each item in their respective mdx file

	// First of all, let's get all the documented blocks and items into a flat array
  const blocksCategories = await fs.readdir(
    path.join(process.cwd(), 'docs', 'blocks'),
  ).then(categories => categories.map(cat => path.join('blocks', cat)));
  const itemsCategories = await fs.readdir(
    path.join(process.cwd(), 'docs', 'items'),
  ).then(categories => categories.map(cat => path.join('items', cat)));
  const allDocumentedItems = await Promise.all(
    [...blocksCategories, ...itemsCategories].map(async category => {
      const categoryPath = path.join(process.cwd(), 'docs', category);
      const itemFiles = await fs
        .readdir(categoryPath)
        // Probably a file instead of a directory, ignore it
        .catch(() => []);
      return itemFiles
        .filter(file => !file.startsWith('_'))
        .map(file => [file.split('.').shift(), path.join(categoryPath, file)]);
    }),
  ).then(nestedItems => Object.fromEntries(nestedItems.flat()));

	// First of all, let's flatten the recipes into a single array for easier processing
	const flatRecipes = flattenRecipes(recipes);

	// Now, we want all the recipes grouped by their output item. If an item has multiple outputs, it will appear in multiple groups.
	const recipesByOutput = {};
	for (const recipe of flatRecipes) {
		const output = recipe.outputs || recipe.result || recipe.fluid;
		const outputsArray = Array.isArray(output) ? output : [output];
		for (const out of outputsArray) {
			const outputId = typeof out === 'string' ? out : out.id;
			if (outputId.startsWith('techreborn:')) {
				recipesByOutput[outputId] = [
					...(recipesByOutput[outputId] || []),
					recipe
				]
			}
		}
	}

	// Finally, let's write the recipes into their respective item mdx files
	for (const [itemFullId, recipes] of Object.entries(recipesByOutput)) {
		const itemId = filterId(itemFullId).split(':').pop();
		const itemDocPath = allDocumentedItems[itemId];
		if (!itemDocPath) {
			// Item documentation not found, skip it
			console.warn(`⚠️  Missing documentation for item: ${itemId}`);
			continue;
		}
		const itemDoc = await fs.readFile(itemDocPath, 'utf8');
		const recipeHeaderIndex = itemDoc.indexOf('### Recipe');
		const nextSectionIndex = itemDoc.indexOf('#', recipeHeaderIndex + '### Recipe'.length + 1);
		if (recipeHeaderIndex < 0) {
			// No recipe section found, skip it
			console.warn(`⚠️  No recipe section found in documentation for item: ${itemId}`);
			continue;
		}
		let newRecipeSection = '### Recipes\n';
		for (const recipe of recipes) {
			const recipeType = recipe.type.split(':').pop();
			const category = ORDER.find(cat => recipeType.includes(cat.name)) || {
				name: recipeType,
				func: 'crafting',
			};
			const converted = formatter[category.func]?.(recipe);
			if (!converted) {
				console.warn(`No formatter found for recipe type: ${recipe.type} for item: ${itemId}`);
				continue;
			}
			newRecipeSection += `\n${converted.mdx}\n`;
		}
		newRecipeSection += '\n';
		const newItemDoc = `${itemDoc.slice(0, recipeHeaderIndex)}${newRecipeSection}${nextSectionIndex > 0 ? itemDoc.slice(nextSectionIndex) : ''}`;
		await fs.writeFile(itemDocPath, newItemDoc, 'utf8');
		console.log(`✅  Updated recipes in documentation for item: ${itemId}`);
	}


	// await fs.writeFile(outputFile, JSON.stringify(recipes, null, 2), "utf8");
	// console.log(`✅  Filtered recipes written to ${outputFile}`);
})();


const ORDER = [
	{name: "alloy_smelter", path: "docs/blocks/machines/alloy_smelter.mdx", func: "electric"},
	{name: "assembling_machine", path: "docs/blocks/machines/assembling_machine.mdx", func: "electric"},
	{name: "chemical_reactor", path: "docs/blocks/machines/chemical_reactor.mdx", func: "electric"},
	{name: "compressor", path: "docs/blocks/machines/compressor.mdx", func: "electric"},
	{name: "distillation_tower", path: "docs/blocks/machines/distillation_tower.mdx", func: "electric"},
	{name: "extractor", path: "docs/blocks/machines/extractor.mdx", func: "electric"},
	{name: "grinder", path: "docs/blocks/machines/grinder.mdx", func: "electric"},
	{name: "implosion_compressor", path: "docs/blocks/machines/implosion_compressor.mdx", func: "electric"},
	{name: "industrial_blast_furnace", path: "docs/blocks/machines/industrial_blast_furnace.mdx", func: "electric"},
	{name: "industrial_centrifuge", path: "docs/blocks/machines/industrial_centrifuge.mdx", func: "electric"},
	{name: "industrial_electrolyzer", path: "docs/blocks/machines/industrial_electrolyzer.mdx", overrides: ["no_digit_group"], func: "electric"},
	{name: "industrial_grinder", path: "docs/blocks/machines/industrial_grinder.mdx", func: "electric"},
	{name: "industrial_sawmill", path: "docs/blocks/machines/industrial_sawmill.mdx", func: "electric"},
	{name: "rolling_machine", path: "docs/blocks/machines/rolling_machine.mdx", func: "crafting"},
	{name: "solid_canning_machine", path: "docs/blocks/machines/solid_canning_machine.mdx", func: "electric", overrides: ["no_digit_group"]},
	{name: "vacuum_freezer", path: "docs/blocks/machines/vacuum_freezer.mdx", func: "electric"},
	{name: "wire_mill", path: "docs/blocks/machines/wire_mill.mdx", func: "electric"},
];

const formatter = {
	// for things that consume power and have a time
	electric: (data) => {
		const config = {
			id: data.id,
			input: data.ingredients.map((obj) => ({
				id: filterId(obj.ingredient),
				qty: !!obj.count ? obj.count : 1,
			})),
			output: data.outputs.map((obj) => ({
				id: filterId(obj.id, obj),
				qty: !!obj.count ? obj.count : 1,
			})),
			tool: data.type,
			meta: {
				...(!!data.power && {power: data.power}),
				...(!!data.time && {time: data.time}),
				...(!!data.heat && {heat: data.heat}),
				...(!!data.fluid && {fluid: {
					amnt: data.fluid.amount.value,
					name: data.fluid.fluid.fluid
				}})
			}
		};
		return {
			mdx: `<Machine config={${JSON.stringify(config, null, 2)}} />`,
			config
		};
	},
	// this machine behaves like a crafting table and passes in recipes the same way
	// i'm going to make power optional since some crafting-esque tables consume power
	crafting: (data) => {
		const config = {
			id: data.id,
			input: [],
			output: [{
				id: data.result.id,
				qty: data.result.count
			}],
			// In case of crafting_shaped or crafting_shapeless, always use the crafting table tool
			tool: data.type.startsWith("minecraft:crafting") ? "minecraft:crafting_table" : data.type,
			meta: {
				...(!!data.power && {power: data.power}),
				...(!!data.time && {time: data.time}),
			}
		};
		if (!!data.ingredients) {
			// if they passed ingredients, that means order doesn't matter
			// these are generally simplier recipes
			const ingredients = data.ingredients.map((obj) => ({
				id: filterId(typeof obj === 'string' ? obj : obj.ingredient),
				qty: !!obj.count ? obj.count : 1,
			}));
			// Pad ingredients to ensure a full 3x3 grid
			const paddedIngredients = Array.from({ length: 9 }, (_, i) => ingredients[i] || " ");
			config.input = paddedIngredients;
		} else if (!!data.pattern) {
			// the standard way of passing in complex recipes
			const patternArr = data.pattern.flatMap(section => section.padEnd(3, " ").split(""));
			// Some recipes do not provide full 3x3 patterns, we need to pad them out
			const paddedPatternArr = Array.from({ length: 9 }, (_, i) => patternArr[i] || " ");
			data.key[" "] = "minecraft:air";
			config.input = paddedPatternArr.map((key) => ({
				id: filterId(data.key[key]),
				qty: 1
			}));
		}
		return {
			mdx: `<Machine config={${JSON.stringify(config, null, 2)}} />`,
			config
		};
	}
}

const filterId = (input, full = null) => {
	// first we need to check to see if input is an object
	// after checking by hand, all items who use input as an object as cells, so that's what we'll assume because i'm lazy, even this line, so long.
	// should result in techreborn:lithium_cell
	if (typeof input === "object") {
		input = `${input.components["techreborn:fluid"]}_cell`;
		// oh but wait, sometimes that doesn't work
		if (input.includes("minecraft:")) { input = input.split("minecraft:").join("techreborn:"); }
	}
	// and some random ass arbitrary filtering for inconsistant minecraft ids
	if (input.includes("#minecraft:") === true || input.includes("#techreborn:") === true) {
		input = input.split("#").join("");
	}
	// this alternates between being a f-it bucket kinda of check and a "we need to override this now" check
	const specialTerms = {
		// some 1:1 terms to what they look like they should be
		"#c:tuff": "minecraft:tuff",
		"#c:basalt": "minecraft:basalt",
		"#c:marble": "minecraft:calcite",
		"#c:limestone": "techreborn:limestone",
		"#c:froglights": "minecraft:froglight",
		"#c:sponges": "minecraft:sponge",
		"#c:sulfurs": "techreborn:sulfur",
		// these image and item names differ
		"#c:ingots/chromium": "techreborn:chrome_ingot",
		"#c:plates/chromium": "techreborn:chrome_plate",
		"#c:storage_blocks/chromium": "techreborn:chrome_storage_block",
		"techreborn:basic_machine_casing": "techreborn:standard_machine_casing",
		"techreborn:dragon_egg_syphon": "techreborn:dragon_egg_energy_siphon",
		"techreborn:lapotronic_orb": "techreborn:lapotronic_energy_orb",
		"techreborn:solid_fuel_generator": "techreborn:generator",
		"techreborn:semi_fluid_generator": "techreborn:semifluid_generator",
		"techreborn:assembly_machine": "techreborn:assembling_machine",
		"techreborn:chunk_loader": "techreborn:industrial_chunkloader",
		"techreborn:low_voltage_su": "techreborn:battery_box",
		"techreborn:medium_voltage_su": "techreborn:mfe",
		"techreborn:high_voltage_su": "techreborn:mfsu",
		"techreborn:adjustable_su": "techreborn:aesu",
		"techreborn:interdimensional_su": "techreborn:idsu",
		"techreborn:lapotronic_su": "techreborn:lesu",
		// if we have more nuggets, we'll write a mapper for them
		"#c:nuggets/iridium": "techreborn:iridium_nugget",
		"#c:nuggets/netherite": "techreborn:netherite_nugget",
		// these _material id's represent a set of materials. i took a common one and used it as a representitive for the sample
		"techreborn:calcite_dust_material": "minecraft:calcite",
		"techreborn:calcite_small_dust_material": "minecraft:bone_meal",
		"techreborn:gravel_material": "minecraft:cobblestone",
		"techreborn:plantball_material": "minecraft:oak_leaves",
		// some spelling fixes
		"minecraft:slime_ball": "minecraft:slimeball",
		"minecraft:water_cell": "techreborn:water_cell",
		"minecraft:cod": "minecraft:raw_cod",
		"minecraft:lapis_block": "minecraft:block_of_lapis_lazuli",
		"minecraft:lapis_ores": "minecraft:block_of_lapis_lazuli",
		"minecraft:ender_eye": "minecraft:eye_of_ender",
		// these are not valid items, so i changed them to my best guess
		"minecraft:prismarine": "minecraft:prismarine_shard",
		"minecraft:quartz": "minecraft:nether_quartz",
		"minecraft:quartz_block": "minecraft:block_of_quartz",
		// this is about turning general item terms into specific ones
		"#c:foods/cooked_meats": "minecraft:cooked_beef",
		"#c:foods/raw_meats": "minecraft:raw_beef",
		"#c:barrels/wooden": "minecraft:barrel",
		"minecraft:planks": "minecraft:oak_planks",
		"minecraft:logs": "minecraft:oak_logs",
		"minecraft:signs": "minecraft:oak_sign",
		"minecraft:wooden_doors": "minecraft:oak_wood_door",
		"minecraft:wooden_fences": "minecraft:oak_fence",
		"minecraft:wooden_pressure_plates": "minecraft:oak_pressure_plate",
		"minecraft:wooden_trapdoors": "minecraft:oak_trapdoor",
		"minecraft:wooden_buttons": "minecraft:oak_button",
		// ae2 mod support mapping (more than this is supported, this just needs mapping)
		"#c:certus_quartz": "ae2:certus_quartz_crystal",
		"#c:ores/certus_quartz": "ae2:budding_certus"
	};
	if (!!specialTerms[input]) { return specialTerms[input]; }
	// we're going to try something wild and assume that any vanilla minecraft object that sends with an S is plural, and we don't want it to be.
	// we'll carve out a list of exception to this rule as we hand test. it's janky, but i don't see you coding this beast.
	const exceptions = ["stairs", "planks", "boots", "leggings", "bars", "glass", "crystals", "seeds", "bricks"];
	if (input.endsWith("s") && !exceptions.some((term) => input.includes(term))) {
		input = input.slice(0, -1);
	}
	// these are called suffix terms because the way of correcting them is by
	// adding the type of thing they are to the end of the input term, eg. 
	// #c:ores/silver -> silver_ore
	const suffixTerms = ["#c:ingots/", "#c:plates/", "#c:dusts/", "#c:ores/", "#c:storage_blocks/"]
	const newSuffixTerms = ["ingot", "plate", "dust", "ore", "storage_block"];
	for (const [index, term] of suffixTerms.entries()) {
		if (input.includes(term) === true) {
			input = `techreborn:${input.split(term).pop()}_${newSuffixTerms[index]}`;
			return input;
		}
	}
	// these are prefix terms for the same reason as above, but ya know
	// a prefix instead of a suffix, eg.
	// #c:raw_materials/lead -> raw_lead
	const prefixTerms = ["#c:raw_materials/"];
	const newPrefixTerms = ["raw"];
	for (const [index, term] of prefixTerms.entries()) {
		if (input.includes(term) === true) {
			input = `techreborn:${newPrefixTerms[index]}_${input.split(term).pop()}`;
			return input;
		}
	}
	// these are remove terms because once we strip the noise they are good
	// #c:foods/lead -> raw_lead
	const removeTerms = ["#c:foods/", "#c:gems/"];
	for (const [index, term] of removeTerms.entries()) {
		if (input.includes(term) === true) {
			input = `techreborn:${input.split(term).pop()}`;
			return input;
		}
	}
	// these are small pile terms because that's all they apply to
	// it's just tricky and i don't wanna be fancy, sometimes repeating yourself is ok
	// loving yourself is the important part. :)
	// #c:small_dusts/calcite -> small_pile_of_calcite_dust
	const pileTerms = ["#c:small_dusts/"];
	for (const [index, term] of pileTerms.entries()) {
		if (input.includes(term) === true) {
			input = `techreborn:small_pile_of_${input.split(term).pop()}_dust`;
			return input;
		}
	}
	// some filtering for outputs that output a cell, but don't include the fluid
	if (input === "techreborn:cell" && !!full?.components?.["techreborn:fluid"]) {
		input = `${full.components["techreborn:fluid"]}_cell`;
		if (input.includes("minecraft:") === true) {
			// to fix input like "minecraft:water_cell"
			input = input.split("minecraft:").join("techreborn:");
		}
	}
	// addressing minecraft vanilla blocks being in the wrong format
	const blockList = ["gold", "iron", "diamond", "emerald", "netherite", "coal", "copper", "amethyst", "redstone", "raw_iron", "raw_gold", "raw_copper"];
	if (input.includes("minecraft:") === true && input.includes("_block") === true) {
		// maybe a match...
		const inputSlug = input.split("minecraft:").pop();
		const blockOnly = inputSlug.split("_block").shift();
		if (blockList.includes(blockOnly) === true) {
			input = `minecraft:block_of_${blockOnly}`;
		}
	}
	// let's catch any unhandled for now
	if (input.includes("#c:") === true) { throw new Error (`Unhandled ID in filterId: ${input}`); }
	// if it didn't match it's...fine?
	return input;
}

const titleCase = (s) =>
	s.replace (/^[-_]*(.)/, (_, c) => c.toUpperCase())
	 .replace (/[-_]+(.)/g, (_, c) => ' ' + c.toUpperCase());


function getPackFromId(id, config) {
	for (const item of config.output) {
		if (item.id.includes(id) === true) { return item.id; }
	}
	return "minecraft:missing_asset";
}