import {geoMercator} from "d3-geo";
import {Pixel} from "./scanner";

// https://observablehq.com/@d3/web-mercator-tiles
export function geoCoords({tx, ty, px, py}: Pixel) {
    const tileScale = 1000;
    const mapScale = 2048 * tileScale;

    const projection = geoMercator()
        .scale(mapScale / (2 * Math.PI))
        .translate([mapScale / 2, mapScale / 2]);
    const x = tx * tileScale + px + 0.5;
    const y = ty * tileScale + py + 0.5;

    const res = projection.invert?.([x, y]);
    if(!res) throw new Error("Coordinates are null for some reason >.>");

    const [lng,lat] = res;
    return {lat: lat.toFixed(6), lng: lng.toFixed(6)};
}

type Coordinates = {lat: string; lng: string};
export const wplaceLink = ({lat,lng}: Coordinates) => `https://wplace.live/?lat=${lat}&lng=${lng}&zoom=15`;