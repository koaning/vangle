# McNugget numbers

Chicken McNuggets used to come in boxes of 6, 9 and 20. You could buy 15 (6 + 9) or 26
(6 + 20), but not 43, however you mixed the boxes. 43 is the largest count you can't buy, and
past it every count works. Below, each count you can buy is a node, joined to the smaller count
it's one box more than, along the way that uses the fewest boxes.

<t-scope class="example" data-show-source>
  <p>Boxes of <t-num name="box1" min="1" max="30" color="#246bce #75a7ff">6</t-num>,
    <t-num name="box2" min="1" max="30" color="#b45b1b #ffad66">9</t-num> and
    <t-num name="box3" min="1" max="30" color="#147a68 #5ed5bd">20</t-num>, counting up to
    <t-num name="limit" min="1" max="100">50</t-num> nuggets.
    <t-out expr="recipe"></t-out></p>
  <t-let name="boxes" expr="[box1, box2, box3]"></t-let>
  <!-- ways[t]: the fewest boxes that make t, the box added last and the count before it, or null. -->
  <t-let name="ways" expr="(() => {
    const ways = [{ count: 0 }];
    for (let t = 1; t <= limit; t++) {
      ways[t] = null;
      for (const box of boxes) {
        const before = ways[t - box];
        if (before && (!ways[t] || before.count + 1 < ways[t].count)) ways[t] = { count: before.count + 1, box, from: t - box };
      }
    }
    return ways;
  })()"></t-let>
  <!-- The boxes for t, biggest first, by following each count back to the one before it. -->
  <t-let name="boxesFor" expr="(t) => {
    const out = [];
    for (; t > 0; t = ways[t].from) out.push(ways[t].box);
    return out.sort((a, b) => b - a);
  }"></t-let>
  <t-let name="recipe" expr="hovered ? `${hovered.name} = ${boxesFor(Number(hovered.id)).join(' + ') || 0}.` : ''"></t-let>
  <t-graph hover="hovered" height="480" distance="32" charge="-70" label="Counts of nuggets you can buy">
    <script type="text/plain">
    {
      directed: true,
      nodes: ways.flatMap((way, t) => way ? [{ id: t, name: t, size: t ? 5 : 8, color: t ? "#6b6459 #b8b0a4" : "currentColor" }] : []),
      edges: ways.flatMap((way, t) => way && t ? [{ source: way.from, target: t, color: boxes.indexOf(way.box) + 1 }] : [])
    }
    </script>
  </t-graph>
  <!-- Every count up to 1,000 that can't be made: past the largest gap, every count works. -->
  <t-let name="gaps" expr="(() => {
    const ok = [true];
    const gaps = [];
    for (let t = 1; t <= 1000; t++) {
      ok[t] = boxes.some((box) => ok[t - box]);
      if (!ok[t]) gaps.push(t);
    }
    return gaps;
  })()"></t-let>
  <t-let name="gcd" expr="boxes.reduce(function g(a, b) { return b ? g(b, a % b) : a; })"></t-let>
  <p><t-out expr="gcd > 1
    ? `Every box holds a multiple of ${gcd}, so no other count can be bought, however many boxes you take.`
    : gaps.length
      ? `You can't buy ${gaps.length === 1 ? gaps[0] : gaps.slice(0, -1).join(', ') + ' or ' + gaps.at(-1)} nuggets. The largest is ${gaps.at(-1)}.`
      : 'You can buy every count.'"></t-out></p>
</t-scope>

## Why it stops at 43

Look at 44 to 49: 44 = 20 + 9 + 9 + 6, 45 = 9 + 9 + 9 + 9 + 9, and so on. That's six
counts in a row, so adding boxes of 6 to them reaches 50 to 55, then 56 to 61, and every count
after. Once some count and the next five can be bought, nothing above them is missing. The
largest count you can't buy is the *Frobenius number* of the box sizes, and for 6, 9 and 20 it's
43.

## Things to try

- **Add the small box.** Later the menu got a box of 4. Set the first box to 4 and the largest
  count you can't buy drops to 23. With all four sizes, 4, 6, 9 and 20, it's 11.
- **Make every box even.** With 6, 10 and 20, no odd count can be bought, so there's no largest.
  The graph only ever reaches even numbers.
- **Two boxes.** Set the last two boxes to 7, so there are only two sizes. For two sizes *a* and
  *b* with no common factor, the largest count you can't buy is *ab* − *a* − *b*, so 6 and 7
  give 29.
- **Watch the graph grow.** Drag the count up slowly. Each new count starts next to the one it
  comes from, and the colors say which box it adds.

## How it's built

- **No script.** The page is markup: four [`<t-num>`](t-num.md)s, a few [`<t-let>`](t-let.md)s
  and a [`<t-graph>`](t-graph.md).
- **One table, two uses.** The `<t-let>` called `ways` works out, for each count, the fewest
  boxes that make it and which count it extends. The graph draws one edge per count, back to
  that one, so the edges form a tree from 0. Following a hovered count back along the tree gives
  its boxes.
- **The graph keeps its shape.** The nodes' ids are the counts, so raising the limit adds nodes
  without moving the old ones. Changing a box size rewires the edges, and the graph settles again.
- **The colors match.** Each `<t-num>` box has a `color`, and the edges use the same palette by
  number: `color: boxes.indexOf(way.box) + 1`.
- **The largest gap** comes from a second table that runs to 1,000. With box sizes up to 30
  and no common factor, the Frobenius number is always below 1,000.

Ported from the McNugget demo in [wigglystuff](https://github.com/koaning/wigglystuff).
