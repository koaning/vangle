# vangle

Reactive documents for static HTML. This is a modern take on Bret Victor's [Tangle](https://worrydream.com/Tangle/), with many widgets to make it easy to compose more engaging pages easily. 

- One ES module (`tangle.js`) and one stylesheet (`tangle.css`). No build step, no dependencies.
- Declarative: posts are plain HTML, and you don't write an `update()` function. Values recompute automatically through a small signals core.
- Dependencies, like KaTeX, are loaded only when a page contains a related element, like `<t-math>`. If your blog already loads `katex`, that copy is used.

To really appreciate what it is all about, you'll have to go here and see everything for yourself.  

https://koaning.github.io/vangle/
