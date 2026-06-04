---
layout: default
title: NightWorkers | Local-first Autonomous Development Control Plane
description: NightWorkers は、ローカル環境で自律開発セッションを制御し、実行証跡を記録するための開発コントロールプレーンです。
permalink: /
image: /assets/img/og-image.jpg
body_class: lp-body
preload_hero: true
twitter_image_alt: NightWorkers の開発コントロールプレーンを表すワークベンチのキービジュアル
og_image_alt: NightWorkers の開発コントロールプレーンを表すワークベンチのキービジュアル
---

<main class="lp">
  <section class="hero">
    <picture class="hero-bg" aria-hidden="true">
      <source srcset="{{ '/assets/img/nightworkers-hero.webp' | relative_url }}" type="image/webp">
      <img
        src="{{ '/assets/img/nightworkers-hero.png' | relative_url }}"
        alt=""
        width="1672"
        height="941"
        loading="eager"
        decoding="async"
        fetchpriority="high"
      >
    </picture>
    <div class="hero-shade" aria-hidden="true"></div>

    <div class="shell hero-shell">
      <header class="topbar">
        <a class="brand" href="{{ '/' | relative_url }}">NightWorkers</a>
        <div class="chip">local-first / run evidence / workbench</div>
      </header>

      <div class="hero-copy">
        <p class="eyebrow">Autonomous Development Control Plane</p>
        <h1>
          自律開発を、<br>
          実行証跡で<br>
          制御する。
        </h1>
        <p class="lead">
          NightWorkers は、プロジェクトごとの Session queue、supervisor-worker 実行、
          run event ledger、diff・todo・test result を束ねるローカルファーストな開発コントロールプレーンです。
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="https://github.com/ugnoguchigxp/nightWorkers">GitHubで見る</a>
          <a class="btn btn-secondary" href="https://github.com/ugnoguchigxp/nightWorkers/blob/main/README.md">READMEを読む</a>
        </div>
      </div>

      <div class="status-strip" aria-label="NightWorkers capability highlights">
        <div><strong>Project + Session</strong><span>folder-scoped work queue</span></div>
        <div><strong>Run Ledger</strong><span>events, diffs, todos, reports</span></div>
        <div><strong>Blueprint Review</strong><span>preview, DB design, adoption</span></div>
      </div>
    </div>
  </section>

  <section class="section intro">
    <div class="shell section-grid">
      <div>
        <p class="section-kicker">Why NightWorkers</p>
        <h2>エージェントの実行を、チャットの外側で運用する。</h2>
      </div>
      <p class="section-lead">
        長い自律開発では、何を依頼したかよりも、どの Session が走り、どこで止まり、
        どんな証跡を残したかが重要になります。NightWorkers はその制御面をローカルに置き、
        queue、run、artifact、review の状態を一つの Workbench で扱います。
      </p>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Core Surfaces</p>
        <h2>Workbench に必要な状態を、最初から分けて扱う。</h2>
      </div>
      <div class="cards">
        <article class="card">
          <h3>Session Queue</h3>
          <p>Project Folder を起点に Session/Task を管理し、Draft、Ready、Queued、Processing を明確に分離します。</p>
        </article>
        <article class="card">
          <h3>Run Evidence</h3>
          <p>run events、todo、context output、diff、test result、final report を再接続可能な ledger として保持します。</p>
        </article>
        <article class="card">
          <h3>Blueprint Review</h3>
          <p>App Blueprint、DB Design、Design Token を artifact として表示し、採用判断を会話と紐づけます。</p>
        </article>
        <article class="card">
          <h3>Runtime Settings</h3>
          <p>LLM provider、MCP Server、Agent Hooks、queue concurrency を UI から調整し、実行面に反映します。</p>
        </article>
      </div>
    </div>
  </section>

  <section class="section section-flow">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Execution Loop</p>
        <h2>依頼から証跡までを、一つの流れで追う。</h2>
      </div>
      <div class="flow">
        <article class="flow-step"><span>01</span><p>Project Folder を登録</p></article>
        <article class="flow-step"><span>02</span><p>Workbench で Session を作成</p></article>
        <article class="flow-step"><span>03</span><p>Queue を Play / Pause</p></article>
        <article class="flow-step"><span>04</span><p>supervisor-worker 実行を記録</p></article>
        <article class="flow-step"><span>05</span><p>artifact と run evidence を確認</p></article>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Boundary</p>
        <h2>NightWorkers は runner ではなく、制御面です。</h2>
      </div>
      <div class="compare">
        <article class="compare-box">
          <h3>Typical Chat Agent UI</h3>
          <ul>
            <li>会話ログが実行状態の代わりになる</li>
            <li>queue と todo が混ざりやすい</li>
            <li>再接続時に run outcome を追いにくい</li>
          </ul>
        </article>
        <article class="compare-box active">
          <h3>NightWorkers</h3>
          <ul>
            <li>Project / Session / run event を永続化</li>
            <li>queue はユーザー操作、todo は run 内部状態として分離</li>
            <li>証跡を Workbench と API から再確認できる</li>
          </ul>
        </article>
      </div>
    </div>
  </section>

  <section class="cta">
    <div class="shell">
      <div class="cta-panel">
        <p class="section-kicker">Local-first by design</p>
        <h2>自律開発を、運用できる単位に戻す。</h2>
        <p>
          NightWorkers は、ローカル環境で実行制御と証跡確認を担うための control plane です。
        </p>
        <a class="btn btn-primary" href="https://github.com/ugnoguchigxp/nightWorkers">GitHub プロジェクトを見る</a>
      </div>
    </div>
  </section>
</main>

<footer class="footer">
  <div class="shell">NightWorkers LP · GitHub Pages + Jekyll</div>
</footer>
