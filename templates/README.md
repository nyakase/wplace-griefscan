# templates
Templates go in here! You will need to know the tile and position for your template. The [Blue Marble](https://github.com/SwingTheVine/Wplace-BlueMarble#installation-instructions) userscript can help you with this.

## Adding tiles
Create a folder inside `templates` named after the tile. For example, if Blue Marble says "Tl X: 19, Tl Y: 1303", the tile is `19 1303` and you should name the folder this. You can then put any template on that tile into its folder (see below). 

**If a template goes across multiple tiles, you must split it into their respective tile folders.** This is a limitation of the scanner, which was not designed to scan more than one tile at once.

## Adding templates
Put your templates into a tile folder (see above). The template should be a PNG and its filename should be in the format of `<Px X> <Px Y> <NAME>.png`. The name can be anything you like, and Px X and Px Y are displayed by Blue Marble.

If Blue Marble says "Tl X: 19, Tl Y: 1303, Px X: 718, Px Y: 432" and I want to name my template seal, the final result is `19 1303/718 423 seal.png`.