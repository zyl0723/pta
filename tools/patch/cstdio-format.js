const _length_type = function (rt, ctrl, length) {
    const wantLong = (length === "ll") || (length === "l") || (length === "L") || (length === "z") || (length === "j") || (length === "t");
    const unsigned = (ctrl === "u") || (ctrl === "o") || (ctrl === "x") || (ctrl === "X");
    if (wantLong) {
        if (length === "ll") {
            return rt.primitiveType(unsigned ? "unsigned long long" : "long long");
        }
        if (unsigned) {
            return rt.unsignedintTypeLiteral;
        }
        return rt.longTypeLiteral;
    }
    return unsigned ? rt.unsignedintTypeLiteral : rt.intTypeLiteral;
};
const format_type_map = function (rt, ctrl, length) {
    switch (ctrl) {
        case "d":
        case "i":
        case "u":
        case "o":
        case "x":
        case "X":
            return _length_type(rt, ctrl, length);
        case "f":
        case "F":
            return rt.floatTypeLiteral;
        case "e":
        case "E":
        case "g":
        case "G":
        case "a":
        case "A":
            return rt.doubleTypeLiteral;
        case "c":
            return rt.charTypeLiteral;
        case "s":
            return rt.normalPointerType(rt.charTypeLiteral);
        case "p":
            return null;
        case "n":
            rt.raiseException("%n is not supported");
            return null;
        default:
            return null;
    }
};
const strip_length_modifiers = function (formatStr) {
    return formatStr.replace(/(%(?:[-+ #0])?(?:[0-9]+|\*)?(?:\.(?:[0-9]+|\*))?)(?:hh|h|ll|l|L|z|j|t)([diuoxXfFeEgGaAcspn])/g, "$1$2");
};