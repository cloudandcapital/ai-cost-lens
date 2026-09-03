# AI Cost Lens 90-second walkthrough

> I built AI Cost Lens because a lower model price does not tell finance whether
> an AI investment is getting better.
>
> This sample makes that problem obvious. The proposed route cuts provider cost
> from $100,000 to $35,000, but its ready-to-use rate falls from 94% to 75% and
> human correction cost rises. Once I divide the full recurring cost by work that
> was actually ready, the proposed route is 4.8% more expensive per usable result.
>
> The tool keeps the financial controls visible. Provider-reported, calculated,
> and allocated costs stay separate. A change cannot be called savings unless the
> work is comparable, the evidence reconciles, the quality floor and policy gates
> pass, and both provider costs are reported rather than estimated.
>
> I also added Plan vs Actual and a time-based decision horizon. Finance can see
> where the current route missed budget, whether output and yield offset that
> variance, and whether a proposed change earns back its implementation cost at
> the expected monthly volume.
>
> The application runs locally in the browser and does not take provider keys. I
> tested the core arithmetic in both the Python and browser paths, used synthetic
> stress cases for decision logic, and tested a saved OpenAI export path without
> manufacturing model-level billed cost the export could not support.
>
> It is not a production monitoring platform or a customer result. It is the
> finance decision layer I wanted between AI telemetry and an investment memo.
