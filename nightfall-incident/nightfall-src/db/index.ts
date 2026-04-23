import localforage from "localforage";

const nightfallDB = localforage.createInstance({
  name: "nightfall",
  version: 1.0,
  storeName: "nightfall-save", // Should be alphanumeric, with underscores.
  description: "Save data for Nightfall",
});

export default nightfallDB;
