import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ped-rdbackup";
const map = `
-A--------B-
C....--....D
-.--------.-
-.--------.-
-.--@--@--.-
-----12-----
-.--@--@--.-
-.---------.-
-.---------.-
E....--....F
-G--------H-
`;
const enemies = [
  Programs.Mandelbug,
  Programs.Mandelbug,
  Programs.Mandelbug,
  Programs.Mandelbug,
  Programs.Mandelbug,
  Programs.Mandelbug,
  Programs.Mandelbug,
  Programs.Mandelbug,
];
const creditValues: number[] = [800, 870];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 28#0:14
// TODO: Pink MandelBug
