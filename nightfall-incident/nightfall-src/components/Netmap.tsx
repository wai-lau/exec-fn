import React from "react";
import cn from "classnames";
import {
  INetmap,
  Direction,
  ALL_DIRECTIONS,
  NodeStatus,
  INetmapNode,
  NetmapPosition,
  IAudioSource,
  IProgram,
} from "../types";
import { AudioContext, IAudioContext } from "../util/AudioContext";
import * as AudioSources from "../audio/audioSources";

import { CreditDisplay } from "./CreditDisplay";
import CurrentPrograms from "./CurrentPrograms";

import "./Netmap.css";
import { leadDebounce, clamp, matchFlag } from "../util/util";
import Button from "./Button";

type NightfallStatus = "entering" | "entered" | "exit" | null;

interface NetmapProps extends INetmap {
  initialScrollX?: number;
  initialScrollY?: number;
  viewWidth: number;
  viewHeight: number;
  onSelectNode: (id: string) => void;
  netmapStatus: { [id: string]: NodeStatus };
  credits: number;
  securityLevel: number;
  showArrows?: boolean;
  programs: IProgram[];
  forceShowPrograms: boolean;
  bindScrollFunction: (f: Netmap["scrollToPosition"]) => void;
  selectedID?: string;
  onMenu: () => void;
  nightfallAvailableNodes?: INetmapNode["id"][];
}

interface NetmapState {
  scale: number;
  scrollDirection: Direction | null;
  nodeHoverSoundIndex: number;
  nightfallStatus: NightfallStatus;
}

export default class Netmap extends React.Component<NetmapProps, NetmapState> {
  static contextType = AudioContext;
  static zoom = 9;
  static velocity = 1000;

  scrollX: number;
  scrollY: number;
  lastScrollAt: null | number;
  bgRef: React.RefObject<HTMLDivElement>;
  audioContext: IAudioContext;
  positionScrollInterval: ReturnType<typeof setTimeout> | null;
  onFinishScroll: ((position: NetmapPosition) => void) | null;

  nodeHoverSounds: IAudioSource[] = [
    AudioSources.HoverC,
    AudioSources.HoverEb,
    AudioSources.HoverF,
  ];

  constructor(props: NetmapProps) {
    super(props);
    this.state = {
      scrollDirection: null,
      nodeHoverSoundIndex: 0,
      scale: Netmap.getScale(),
      nightfallStatus: props.nightfallAvailableNodes === undefined ? null : "entered",
    };
    this.scrollX = props.initialScrollX || 0;
    this.scrollY = props.initialScrollY || 0;
    this.lastScrollAt = null;
    this.bgRef = React.createRef();
    this.audioContext = this.context;
    this.positionScrollInterval = null;
    this.onFinishScroll = null;
  }

  static getScale = () => {
    return (
      parseFloat(getComputedStyle(document.getElementsByClassName("container")[0]).fontSize) /
      Netmap.zoom
    );
  };

  componentDidMount() {
    this.audioContext = this.context;
    this.audioContext.player.playAudio(AudioSources.Netmap, { loop: true });

    this.props.bindScrollFunction(this.scrollToPosition);

    // If the size of the netmap container changes without the size of the window changes, then this won't fire. Probably okay for now.
    window.addEventListener("resize", this.onResize);
  }

  componentDidUpdate(prevProps: NetmapProps) {
    if (
      this.props.nightfallAvailableNodes !== undefined &&
      prevProps.nightfallAvailableNodes === undefined
    ) {
      this.setState(() => ({ nightfallStatus: "entering" }));
    } else if (
      this.props.nightfallAvailableNodes === undefined &&
      prevProps.nightfallAvailableNodes !== undefined
    ) {
      this.setState(() => ({ nightfallStatus: "exit" }));
    }
  }

  onResize = () => {
    this.setState(
      {
        scale: Netmap.getScale(),
      },
      () => {
        this.updateScroll();
      }
    );
  };

  getNextHoverSound = () => {
    const { nodeHoverSoundIndex } = this.state;
    const { nodeHoverSounds } = this;
    this.setState((state) => ({
      ...state,
      nodeHoverSoundIndex: (state.nodeHoverSoundIndex + 1) % nodeHoverSounds.length,
    }));
    return nodeHoverSounds[nodeHoverSoundIndex];
  };

  onMouseEnter = leadDebounce(async () => {
    await this.audioContext.player.playAudio(this.getNextHoverSound());
  }, 500);

  getViewDimensions = () => {
    const { width, height } = document.querySelector(".netmap-container")!.getBoundingClientRect();
    const { scale } = this.state;
    return [width / scale, height / scale] as NetmapPosition;
  };

  scrollToPosition = (p: NetmapPosition, duration: number = 100) => {
    this.cancelScrollToPosition();

    const { dimensions } = this.props;
    const [width, height] = dimensions;
    const [viewWidth, viewHeight] = this.getViewDimensions();
    const startX = this.scrollX,
      startY = this.scrollY;
    const startTime = +new Date();
    const endX = clamp(p[0] - viewWidth / 2, 0, width - viewWidth);
    const endY = clamp(p[1] - viewHeight / 2, 0, height - viewHeight);
    const deltaX = (endX - startX) / duration;
    const deltaY = (endY - startY) / duration;

    this.positionScrollInterval = setInterval(() => {
      requestAnimationFrame(() => {
        const timeElapsed = +new Date() - startTime;
        this.scrollX = Math.min(timeElapsed, duration) * deltaX + startX;
        this.scrollY = Math.min(timeElapsed, duration) * deltaY + startY;

        this.updateScroll();

        if (timeElapsed > duration) {
          this.cancelScrollToPosition();
        }
      });
    }, 5);

    return new Promise<NetmapPosition>((resolve) => {
      this.onFinishScroll = (p: NetmapPosition) => resolve(p);
    });
  };

  cancelScrollToPosition = () => {
    if (this.positionScrollInterval) {
      clearInterval(this.positionScrollInterval);
      this.positionScrollInterval = null;
    }
    if (this.onFinishScroll) {
      const p: NetmapPosition = [this.scrollX, this.scrollY];
      this.onFinishScroll(p);
      this.onFinishScroll = null;
    }
  };

  arrowScroll = () => {
    this.cancelScrollToPosition();

    const { scrollDirection } = this.state;
    const { dimensions } = this.props;
    const [width, height] = dimensions;
    if (!scrollDirection) {
      return;
    }
    if (this.lastScrollAt === null) {
      this.lastScrollAt = +new Date();
      throw new Error("Cannot scroll without an active scroll");
    }
    const [viewWidth, viewHeight] = this.getViewDimensions();
    const deltaTime = (+new Date() - this.lastScrollAt) / 1000;
    switch (scrollDirection) {
      case Direction.Up: {
        this.scrollY = Math.max(this.scrollY - deltaTime * Netmap.velocity, 0);
        break;
      }
      case Direction.Down: {
        this.scrollY = Math.min(this.scrollY + deltaTime * Netmap.velocity, height - viewHeight);
        break;
      }
      case Direction.Left: {
        this.scrollX = Math.max(this.scrollX - deltaTime * Netmap.velocity, 0);
        break;
      }
      case Direction.Right: {
        this.scrollX = Math.min(this.scrollX + deltaTime * Netmap.velocity, width - viewWidth);
        break;
      }
    }
    this.updateScroll();
    this.lastScrollAt = +new Date();
    requestAnimationFrame(this.arrowScroll);
  };

  updateScroll = () => {
    if (!this.bgRef.current) {
      return;
    }
    this.bgRef.current.style.transform = this.getTransformStyle();
  };

  startScroll = (direction: Direction) => {
    this.setState(
      {
        scrollDirection: direction,
      },
      () => {
        this.lastScrollAt = +new Date();
        this.arrowScroll();
      }
    );

    document.body.addEventListener("mouseup", this.endScroll);
    document.body.addEventListener("touchend", this.endScroll);
  };

  endScroll = () => {
    document.body.removeEventListener("mouseup", this.endScroll);
    document.body.removeEventListener("touchend", this.endScroll);
    this.setState(
      {
        scrollDirection: null,
      },
      () => {
        this.lastScrollAt = null;
      }
    );
  };

  componentWillUnmount = () => {
    document.body.removeEventListener("mouseup", this.endScroll);
  };

  getTransformStyle = () =>
    `translate(${-1 * this.scrollX * this.state.scale}px, ${
      -1 * this.scrollY * this.state.scale
    }px) scale(${this.state.scale})`;

  renderNode = (node: INetmapNode) => {
    const { selectedID, nodes, positions } = this.props;
    const { id } = node;
    const position = positions[id];
    if (!position) {
      throw new Error(`Node ${id} had no position`);
    }
    const [x, y] = position;
    const status = this.props.netmapStatus[node.id];
    const className = cn([
      "netmap-node",
      { invisible: status === undefined || status === NodeStatus.INVISIBLE },
      { cleared: status === NodeStatus.CLEARED },
      { uncleared: !matchFlag(status, NodeStatus.WON) },
      { selected: id === selectedID },
    ]);
    const imgSrc =
      status === NodeStatus.CLEARED
        ? node.nodeStyle.clearedIcon
        : !matchFlag(status, NodeStatus.WON)
        ? node.nodeStyle.unclearedIcon
        : "";
    const nodeStyle = {
      top: y + "px",
      left: x + "px",
    };
    const onClick = () => this.props.onSelectNode(id);
    return (
      <div key={"node-" + id} className={className} style={nodeStyle}>
        <img src={imgSrc} onClick={onClick} onMouseEnter={this.onMouseEnter} />
        <div className="node-tooltip">
          <span>{node.nodeStyle.netmapOrgName}</span>
          <span>{node.name}</span>
          <span>Security Level {node.securityLevel}</span>
        </div>
      </div>
    );
  };

  renderNodes() {
    const { nodes, nightfallAvailableNodes } = this.props;
    const nodeElsUnderNightfall = nodes
      .filter((node) => !nightfallAvailableNodes?.includes(node.id))
      .map(this.renderNode);
    const nightfallStatus = cn(["nightfall", this.state.nightfallStatus]);
    const nightfallShield = <div className={nightfallStatus} />;
    const nodeElsAboveNightfall =
      nightfallAvailableNodes &&
      nodes.filter((node) => nightfallAvailableNodes.includes(node.id)).map(this.renderNode);
    return [...nodeElsUnderNightfall, nightfallShield, nodeElsAboveNightfall];
  }

  render() {
    const { image, dimensions, viewHeight, viewWidth, credits, showArrows = true } = this.props;
    const containerStyle = {
      height: viewHeight,
      width: viewWidth,
    };
    const bgStyle = {
      backgroundImage: "url(" + image + ")",
      width: dimensions[0] + "px",
      height: dimensions[1] + "px",
      transform: this.getTransformStyle(),
    };
    const nodeEls = this.renderNodes();
    const creditsEl = (
      <div className="top-right-controls">
        <CreditDisplay numCredits={credits} />
        <Button isBold onClick={this.props.onMenu}>
          Menu
        </Button>
      </div>
    );
    const arrowEls =
      showArrows &&
      ALL_DIRECTIONS.map((dir) => (
        <div
          className={`arrow arrow-${dir}`}
          key={dir}
          onTouchStart={this.startScroll.bind(this, dir)}
          onMouseDown={this.startScroll.bind(this, dir)}
        />
      ));
    return (
      <div className="netmap-container" style={containerStyle}>
        <div className="netmap-bg" ref={this.bgRef} style={bgStyle}>
          {nodeEls}
        </div>
        {creditsEl}
        {arrowEls}
        <CurrentPrograms
          forceOn={this.props.forceShowPrograms}
          currentPrograms={this.props.programs}
        />
      </div>
    );
  }
}
