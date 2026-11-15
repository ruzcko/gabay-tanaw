import { QuickEngine } from './engine.js';

const engine=new QuickEngine();
// Cancellation terminates the worker from its host: synchronous rays cannot observe messages.
self.onmessage=async(event                                                                                            )=>{
  const {id,selection,horizon,sceneOnly}=event.data;
  try {self.postMessage({id,result:sceneOnly?await engine.snapshot(selection):await engine.run(selection,{horizon})});}
  catch(error) {self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
