"""agent-service — self-learning scheduling agent (M2-C1 phase B skeleton).

What ``/agent/*`` actually serves: a cold-start **affinity learner** (imitation of the CP-SAT
teacher) plus a **batch re-fit** from accumulated manager feedback, layered on the FROZEN
ProblemInput/SolveResult contract and the live optimizer (``POST /solve``). A Gymnasium environment
scaffold ships alongside it in :mod:`app.env`, but **no reinforcement-learning algorithm is trained
or served** — nothing in this package imports Stable-Baselines3. This is the first demonstrable
increment, NOT a production RL brain — see ``README.md``.
"""
