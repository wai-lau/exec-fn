export interface IPUQueue<T> {
  getLevel: (val: T) => number | null;
  push: (val: T, level: number) => boolean;
  pop: () => [T, number] | null;
}

export default class PUQueue<T> {
  levels: T[][];
  currentLevel: number;
  values: Map<T, number>;
  popped: Set<T>;

  constructor() {
    this.levels = [];
    this.currentLevel = 0;
    this.values = new Map<T, number>();
    this.popped = new Set<T>();
  }

  getLevel(val: T) {
    return this.values.get(val) || null;
  }

  push(val: T, level: number) {
    if (this.popped.has(val)) {
      return false;
    }
    if (this.values.has(val)) {
      const currentLevel = this.values.get(val)!;
      if (currentLevel <= level) {
        return false;
      } else if (currentLevel && currentLevel > level) {
        const index = this.levels[currentLevel].indexOf(val);
        this.levels[currentLevel].splice(index, 1);
        this.levels[level].push(val);
        return true;
      }
    }
    if (Math.floor(level) !== level) {
      throw new Error("Level must be integer");
    }
    if (level < this.currentLevel) {
      this.currentLevel = level;
    }
    while (this.levels.length <= level) {
      this.levels.push([]);
    }
    this.levels[level].push(val);
    this.values.set(val, level);
    return true;
  }

  pop() {
    while (this.currentLevel < this.levels.length) {
      const level = this.levels[this.currentLevel];
      let next;
      if ((next = level.shift())) {
        this.popped.add(next);
        this.values.delete(next);
        return [next, this.currentLevel];
      }
      this.currentLevel++;
    }
    return null;
  }
}
