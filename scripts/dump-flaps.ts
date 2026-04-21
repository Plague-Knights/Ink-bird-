import { planAutoFlapper } from "../src/lib/autoFlapper";
const p = planAutoFlapper(42);
console.log("framesRun:", p.framesRun, "deadAt:", p.deadAtFrame, "pipes:", p.pipesPassed);
console.log("flaps at frames:", p.inputs.map(i => i.f).join(","));
