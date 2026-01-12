---
title: MV Transformer
---

# MV Transformer

<ItemImage file="mv_transformer" alt="MV Transformer" size="200" />

The **MV Transformer** converts energy from High to Medium tier. For more details and how to use, read [general information about Transformers](/docs/blocks/transformers).

| Input   | Output  |
|---------|---------|
| 512 E/t | 128 E/t |

### Recipes

<Machine config={{
  "id": "mv_transformer",
  "input": [
    {
      "id": "techreborn:insulated_gold_cable",
      "qty": 1
    },
    {
      "id": "minecraft:air",
      "qty": 1
    },
    {
      "id": "minecraft:air",
      "qty": 1
    },
    {
      "id": "techreborn:basic_machine_frame",
      "qty": 1
    },
    {
      "id": "minecraft:air",
      "qty": 1
    },
    {
      "id": "minecraft:air",
      "qty": 1
    },
    {
      "id": "techreborn:insulated_gold_cable",
      "qty": 1
    },
    {
      "id": "minecraft:air",
      "qty": 1
    },
    {
      "id": "minecraft:air",
      "qty": 1
    }
  ],
  "output": [
    {
      "id": "techreborn:mv_transformer"
    }
  ],
  "tool": "minecraft:crafting_table",
  "meta": {}
}} />

### Usage

Used as an ingredient in the <McItem slug="minecraft:crafting_table" inline={true}/> to produce:

- <McItem slug="techreborn:hv_transformer" inline={true}/>
