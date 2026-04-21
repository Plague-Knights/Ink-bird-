import { initialState, step, type SimInput, PIPE_GAP, PIPE_WIDTH } from "../src/lib/simulate";
import { planAutoFlapper } from "../src/lib/autoFlapper";

const seed = 42;
const plan = planAutoFlapper(seed);
console.log("plan:", { framesRun: plan.framesRun, deadAtFrame: plan.deadAtFrame, pipesPassed: plan.pipesPassed, drops: plan.dropletsCollected, flaps: plan.inputs.length });

const state = initialState(seed);
let lastFlapFrame = -1;
for (let f = 0; f < (plan.deadAtFrame ?? plan.framesRun); f++) {
  const flap = plan.inputs.find(i => i.f === f);
  if (flap) lastFlapFrame = f;
  step(state, plan.inputs);
  if (f % 5 === 0 || state.dead) {
    const next = state.pipes.find(p => p.x + PIPE_WIDTH > state.bird.x - 12);
    const target = next ? next.top + PIPE_GAP / 2 : "-";
    console.log(`f=${f.toString().padStart(3)} y=${state.bird.y.toFixed(1).padStart(6)} vy=${state.bird.vy.toFixed(2).padStart(6)}  pipe@(x=${next?.x.toFixed(0)}, top=${next?.top.toFixed(0)}, gap=${target})  flap=${flap ? "Y" : "."}  dead=${state.dead}`);
  }
  if (state.dead) break;
}
