import React from "react";
import { resolveImage } from "../util/util";

interface ImageLoaderProps {
  imgs: string[];
  onDone: () => void;
}

interface ImageLoaderState {
  statuses: Record<string, boolean>;
}

export default class ImageLoader extends React.Component<ImageLoaderProps, ImageLoaderState> {
  constructor(props: ImageLoaderProps) {
    super(props);

    const initialStatuses = props.imgs
      .map((img) => ({ [img]: false }))
      .reduce((val, next) => ({ ...val, ...next }), {});
    this.state = {
      statuses: initialStatuses,
    };
  }

  componentDidMount() {
    this.startLoad();
  }

  componentDidUpdate() {
    if (!Object.values(this.state.statuses).includes(false)) {
      this.props.onDone();
    }
  }

  createOnLoad = (img: string) => () => {
    this.setState((state) => ({
      statuses: { ...state.statuses, [img]: true },
    }));
  };

  startLoad = () => {
    this.props.imgs.forEach((img) => {
      const imgEl = new Image();
      imgEl.src = resolveImage(img);
      imgEl.addEventListener("load", this.createOnLoad(img));
    });
  };

  render() {
    return null;
  }
}
